import { randomUUID } from "node:crypto";
import { type FunctionToolCall, type InputItem, type Tool, SpaceXAI } from "@xai-official/sdk";
import { toolSearch } from "@xai-official/sdk/tools";
import { NOW } from "./data.ts";
import type { Operation } from "./workspace.ts";

// With every tool up front, a request is tens of thousands of tokens, which can run into a
// tokens-per-minute rate limit. A rate-limited request waits and tries again, up to five times.
const client = new SpaceXAI({ maxRetries: 5 });
const MAX_REQUESTS = 8;

export type Usage = { requests: number; input: number; cached: number; output: number; cost: number };
export type AgentEvents = {
  search?: (query: string) => void;
  loaded?: (names: string[]) => void;
  call?: (id: string, name: string, args: { [name: string]: unknown }) => void;
  // The status is "ok", "dry run" for a tool that would have changed something, or "error".
  result?: (id: string, status: string, body: string) => void;
  text?: (text: string) => void;
  usage?: (usage: Usage) => void;
};

// Answers the question, calling tools until Grok has what it needs. With deferred loading, the
// prompt lists only the tools' names, and Grok loads the definitions it needs with tool search.
// Without it, every definition is in the prompt of every request.
export async function ask(question: string, operations: Operation[], deferred: boolean, on: AgentEvents = {}, signal?: AbortSignal) {
  const byName = new Map(operations.map((operation) => [operation.name, operation]));
  const tools: Tool[] = deferred ? [...operations.map(({ tool }) => ({ ...tool, defer_loading: true })), toolSearch()] : operations.map(({ tool }) => tool);
  const input: InputItem[] = [{ role: "system", content: instructions(deferred) }, { role: "user", content: question }];
  const usage: Usage = { requests: 0, input: 0, cached: 0, output: 0, cost: 0 };
  const promptCacheKey = randomUUID();
  for (let request = 0; request < MAX_REQUESTS; request++) {
    const outputs: InputItem[] = [];
    const stream = await client.responses.create(
      { model: "grok-4.7", reasoning: { effort: "low" }, input, tools, prompt_cache_key: promptCacheKey, stream: true },
      { signal },
    );
    const response = await stream
      .on("server_tool_call", (call) => {
        if (call.type === "tool_search_call") on.search?.((call.arguments as { query?: string } | undefined)?.query ?? "");
      })
      // The definitions a search loaded arrive as their own output item, after the search call.
      .on("response.output_item.done", ({ item }) => {
        if (item.type === "tool_search_output" && "tools" in item) on.loaded?.((item.tools as Array<{ name: string }>).map((tool) => tool.name));
      })
      .on("client_tool_call", (call) => {
        if (call.type === "function_call") outputs.push(runCall(call, byName, on));
      })
      .on("text", (text) => on.text?.(text))
      .done();
    usage.requests++;
    usage.input += response.usage.input_tokens;
    usage.cached += response.usage.input_tokens_details.cached_tokens;
    usage.output += response.usage.output_tokens;
    usage.cost += response.usage.cost_usd ?? 0;
    on.usage?.({ ...usage });
    if (!outputs.length) return { answer: response.toText(), usage };
    input.push(...response.toInput(), ...outputs);
  }
  throw new Error(`Grok was still calling tools after ${MAX_REQUESTS} requests`);
}

function instructions(deferred: boolean): string {
  const now = new Date(NOW).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short" });
  // Tool search matches words, so a descriptive query brings back loosely related tools. Grok sees
  // every name, though, and searching for one exact name loads just that tool.
  const loading = deferred ? " Only their names are loaded. Pick every tool you'll need from the names, then load their definitions with tool search, all at once: one search per tool, each with its exact name as the query, like slack_search_messages, and a limit of 1. Never call a tool you haven't loaded." : "";
  return `You're the assistant of Maya Chen, an engineering manager at Larkspur, a company that sells booking software to fitness and wellness studios. Her workspace is connected to GitHub, Slack, Linear, Notion, Google Calendar, Gmail, Sentry, and Stripe, and each tool's name starts with its service. "Me" and "my" mean Maya.${loading} Tools that would change something only say what they would have done, so use them only when Maya asks for a change, and tell her nothing was changed. Make as few calls as you can. Then answer in two to four plain sentences, without Markdown, with the names, numbers, and times you found. It's ${now}, Pacific Time.`;
}

// Grok picks the tool and its arguments, so only tools in the list run, and a failed call goes back
// to Grok as the result instead of ending the run.
function runCall(call: FunctionToolCall, byName: Map<string, Operation>, on: AgentEvents): InputItem {
  let args: { [name: string]: unknown } = {};
  let status = "error";
  let body: string;
  try {
    args = JSON.parse(call.arguments || "{}");
    on.call?.(call.call_id, call.name, args);
    const operation = byName.get(call.name);
    if (!operation) throw new Error(`There's no tool named ${call.name}`);
    const result = operation.run(args);
    status = result.status;
    body = JSON.stringify(result.data);
  } catch (error) {
    body = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
  on.result?.(call.call_id, status, body);
  return { type: "function_call_output", call_id: call.call_id, output: body };
}
