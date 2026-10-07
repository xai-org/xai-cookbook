import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ClientToolCall, type FunctionToolCall, type InputItem, type ShellCall, SpaceXAI, type Tool } from "@xai-official/sdk";
import type { FileChange } from "./diff.ts";
import { type CommandResult, checkCommand, createWorkspace, listFiles, repoChanges, runCommand, testArgs, writeRepoFile } from "./workspace.ts";

// A run makes a request for every turn, and one failed request would end the run and lose its work, so a
// request that fails before Grok has streamed anything is sent again.
const client = new SpaceXAI({ retryBeforeOutput: true });

const MODEL = "grok-4.7";
// A run that's still calling tools after this many requests stops, so a model that loops can't run up
// a bill.
const MAX_TURNS = 25;
// Once a request's input passes this many tokens, everything before its turn is compacted. A summary
// loses details like file names, so it's worth it only once the conversation is long.
const COMPACT_AT = 20_000;
const SKILL_PATH = "skills/fix-a-bug";

const SYSTEM_PROMPT = `You fix bugs in a small JavaScript repo. Your working directory is the repo's root.
- Use the shell tool to look around, read code, and run tests. Each command runs in the repo root without a shell, so pipes, redirects, globs, variables, &&, and cd don't work. To run several commands, send them together in one call.
- These commands run right away: ls, cat, head, tail, wc, grep, find, pwd, and node --test or npm test, with paths inside the repo. Anything else waits for a person to approve it, and they may say no.
- Change files only with the write_file tool, passing the whole new file.
- A skill is a folder with a SKILL.md file of instructions. When one fits the task, read its SKILL.md with cat before anything else, and follow it.
- When every test passes, stop calling tools and say in two or three sentences what was wrong and what you changed.`;

const WRITE_FILE: Tool = {
  type: "function",
  name: "write_file",
  description: "Create or replace a file in the repo. Pass its path relative to the repo root and its full new content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative to the repo root, like src/money.js" },
      content: { type: "string", description: "The whole file as it should be" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

export type CommandRun = CommandResult & { denied?: boolean };
export type TurnUsage = { turn: number; inputTokens: number; cachedTokens: number; outputTokens: number; cost: number };
export type Compaction = { messages: number; tokens: number; cost: number };
export type Fix = { dir: string; summary: string; changes: FileChange[]; testsPass: boolean; finished: boolean; turns: number; cost: number };

export type AgentEvents = {
  start?: (run: { dir: string; files: string[]; compactAt: number }) => void;
  turn?: (turn: number) => void;
  reasoning?: (text: string) => void;
  text?: (text: string) => void;
  command?: (id: string, command: string) => void;
  // Decides whether a command that isn't on the allowlist runs. Without it, those commands are denied.
  approve?: (id: string, command: string, reason: string) => Promise<boolean>;
  result?: (id: string, result: CommandRun) => void;
  write?: (id: string, path: string, error?: string) => void;
  changes?: (changes: FileChange[]) => void;
  usage?: (usage: TurnUsage) => void;
  compacted?: (compaction: Compaction) => void;
  verified?: (result: CommandResult) => void;
};

type Prices = { input: number; cached: number; output: number };

// Copies the sample repo to a fresh folder and lets Grok work on the bug there until a turn makes no
// tool calls. Then it runs the tests itself to check the fix, and saves the changes as fix.patch.
export async function fixBug(report: string, on: AgentEvents = {}, signal?: AbortSignal): Promise<Fix> {
  const dir = join("output", runName(report));
  const root = await createWorkspace(dir);
  on.start?.({ dir, files: await listFiles(root), compactAt: COMPACT_AT });
  const [prices, skill] = await Promise.all([fetchPrices(signal), readSkill(root, SKILL_PATH)]);
  const tools: Tool[] = [{ type: "shell", environment: { type: "local", skills: [skill] } }, WRITE_FILE];
  // One key for the whole run sends every request to the same server, where the start of the
  // conversation is still cached.
  const cacheKey = `bug-report-to-fix:${randomUUID()}`;
  let input: InputItem[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Here's a bug report. Find the cause and fix it.\n\n${report}` },
  ];
  let changes: FileChange[] = [];
  const reportChanges = async () => {
    const latest = await repoChanges(root);
    if (JSON.stringify(latest) === JSON.stringify(changes)) return;
    changes = latest;
    on.changes?.(changes);
  };

  let cost = 0;
  let summary = "";
  let turn = 0;
  while (turn < MAX_TURNS) {
    turn++;
    on.turn?.(turn);
    const outputs: InputItem[] = [];
    // Each call starts as soon as it has streamed in, but only after the one before it finishes, since
    // a test run right after an edit has to see the edit.
    let queue = Promise.resolve();
    const stream = await client.responses.create(
      { model: MODEL, input, tools, reasoning: { effort: "medium" }, prompt_cache_key: cacheKey, stream: true },
      // Grok streams its reasoning as it thinks, so a minute without a chunk means the stream has stalled.
      { signal, idleTimeout: 60_000 },
    );
    const response = await stream
      .on("reasoning", (text) => on.reasoning?.(text))
      .on("text", (text) => on.text?.(text))
      .on("client_tool_call", (call) => {
        queue = queue.then(async () => {
          outputs.push(await runCall(call, root, on, signal));
          await reportChanges();
        });
      })
      .done();
    await queue;

    const usage = response.usage;
    const turnCost = costOf(usage.input_tokens, usage.input_tokens_details.cached_tokens, usage.output_tokens, prices);
    cost += turnCost;
    on.usage?.({ turn, inputTokens: usage.input_tokens, cachedTokens: usage.input_tokens_details.cached_tokens, outputTokens: usage.output_tokens, cost: turnCost });
    if (!outputs.length) {
      summary = response.toText().trim() || "Grok stopped without saying what it changed.";
      break;
    }
    // The latest turn stays as it is, so Grok still sees exactly what its last commands printed.
    if (usage.input_tokens > COMPACT_AT) {
      const compacted = await compact(input, prices, signal);
      input = compacted.input;
      cost += compacted.cost;
      on.compacted?.({ messages: compacted.messages, tokens: usage.input_tokens, cost: compacted.cost });
    }
    input = [...input, ...response.toInput(), ...outputs];
  }

  const check = await runCommand(testArgs(root, []), root, {}, signal);
  on.verified?.(check);
  if (changes.length) await writeFile(join(dir, "fix.patch"), changes.map((change) => change.patch).join(""));
  return {
    dir,
    summary: summary || `Stopped after ${MAX_TURNS} turns without finishing.`,
    changes,
    testsPass: check.exitCode === 0,
    finished: Boolean(summary),
    turns: turn,
    cost,
  };
}

// Tools never throw, so a failing call goes back to Grok as its output and can't stop the run.
async function runCall(call: ClientToolCall, root: string, on: AgentEvents, signal?: AbortSignal): Promise<InputItem> {
  if (call.type === "shell_call") return runShellCall(call, root, on, signal);
  return runFunctionCall(call, root, on);
}

// A shell call can hold several commands. Each gets its own result, in the same order.
async function runShellCall(call: ShellCall, root: string, on: AgentEvents, signal?: AbortSignal): Promise<InputItem> {
  const { commands, timeout_ms, max_output_length } = call.action;
  const output = [];
  for (const [index, command] of commands.entries()) {
    const result = await runShellCommand(`${call.call_id}/${index}`, command, root, { timeoutMs: timeout_ms, maxOutput: max_output_length }, on, signal);
    const outcome = result.timedOut ? { type: "timeout" as const } : { type: "exit" as const, exit_code: result.exitCode };
    output.push({ stdout: result.stdout, stderr: result.stderr, outcome });
  }
  return { type: "shell_call_output", call_id: call.call_id, max_output_length, output };
}

async function runShellCommand(
  id: string,
  command: string,
  root: string,
  limits: { timeoutMs?: number | null; maxOutput?: number | null },
  on: AgentEvents,
  signal?: AbortSignal,
): Promise<CommandRun> {
  on.command?.(id, command);
  const check = checkCommand(command, root);
  let result: CommandRun;
  if ("argv" in check) {
    result = await runCommand(check.argv, root, limits, signal);
  } else if (await on.approve?.(id, command, check.reason).catch(() => false)) {
    result = await runCommand(command, root, limits, signal);
  } else {
    const stderr = `The user denied this command, so it didn't run. It needed approval because ${check.reason}.`;
    result = { stdout: "", stderr, exitCode: 1, timedOut: false, denied: true };
  }
  on.result?.(id, result);
  return result;
}

async function runFunctionCall(call: FunctionToolCall, root: string, on: AgentEvents): Promise<InputItem> {
  let output: string;
  let path = "";
  try {
    if (call.name !== "write_file") throw new Error(`there's no tool called ${call.name}`);
    const args = JSON.parse(call.arguments) as { path?: unknown; content?: unknown };
    if (typeof args.path !== "string" || typeof args.content !== "string") throw new Error("write_file needs a path and the file's content");
    path = args.path;
    const written = await writeRepoFile(root, path, args.content);
    on.write?.(call.call_id, written);
    output = `Wrote ${written}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    on.write?.(call.call_id, path, message);
    output = `Couldn't write the file: ${message}.`;
  }
  return { type: "function_call_output", call_id: call.call_id, output };
}

// Replaces the conversation with one encrypted item that keeps the system prompt, the bug report, and
// a summary of the work so far, so later requests resend far fewer tokens.
async function compact(input: InputItem[], prices: Prices, signal?: AbortSignal): Promise<{ input: InputItem[]; messages: number; cost: number }> {
  const compacted = await client.responses.compact({ model: MODEL, input }, { signal });
  const usage = compacted.usage;
  const cost = usage ? costOf(usage.input_tokens, usage.input_tokens_details.cached_tokens, usage.output_tokens, prices) : 0;
  return { input: [...compacted.output], messages: usage?.dropped_message_count ?? 0, cost };
}

// The skill's name and description come from its front matter. They're all Grok sees of it until it
// reads SKILL.md through the shell tool.
async function readSkill(root: string, path: string): Promise<{ name: string; description: string; path: string }> {
  const text = await readFile(join(root, path, "SKILL.md"), "utf8");
  const field = (name: string) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1] ?? "";
  return { name: field("name"), description: field("description"), path };
}

// The compaction response has no cost, so every cost here is worked out the same way, from token counts
// and the model's prices. Prices come in US cents per 100 million tokens. Runs stay far below the
// 200,000-token long-context tier, so its higher prices don't apply.
async function fetchPrices(signal?: AbortSignal): Promise<Prices> {
  const model = await client.models.language.get(MODEL, { signal });
  return {
    input: model.prompt_text_token_price / 1e10,
    cached: model.cached_prompt_text_token_price / 1e10,
    output: model.completion_text_token_price / 1e10,
  };
}

function costOf(inputTokens: number, cachedTokens: number, outputTokens: number, prices: Prices): number {
  return (inputTokens - cachedTokens) * prices.input + cachedTokens * prices.cached + outputTokens * prices.output;
}

function runName(report: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  const slug = report.split("\n")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return `${stamp}-${slug || "bug"}`;
}
