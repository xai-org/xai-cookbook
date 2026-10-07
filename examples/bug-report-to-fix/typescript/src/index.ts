import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { fixBug } from "./agent.ts";

type Sample = { title: string; body: string };

const SAMPLES = JSON.parse(await readFile(new URL("../sample-bugs.json", import.meta.url), "utf8")) as Sample[];
// Commands can print a lot. The terminal shows this many lines of each, and Grok gets more.
const SHOWN_LINES = 30;

const arg = process.argv.slice(2).join(" ").trim();
const sample = SAMPLES[Number(arg || 1) - 1];
const report = sample ? `${sample.title}\n\n${sample.body}` : arg;

// Reasoning and answers stream in pieces, so this remembers whether the cursor is partway along a line,
// and which of the two it's in.
let midLine = false;
let streaming: "reasoning" | "text" | undefined;
const line = (text = "") => {
  process.stdout.write(`${midLine ? "\n" : ""}${text}\n`);
  midLine = false;
  streaming = undefined;
};
const stream = (kind: "reasoning" | "text", text: string) => {
  if (streaming !== kind && midLine) line();
  streaming = kind;
  process.stdout.write(kind === "reasoning" ? styleText("dim", text) : text);
  if (text) midLine = !text.endsWith("\n");
};

line(styleText("bold", report.split("\n")[0]));
const started = Date.now();
const fix = await fixBug(report, {
  start: ({ dir }) => line(styleText("dim", `Copied the sample repo to ${dir}/repo`)),
  turn: (turn) => line(styleText("dim", `\nTurn ${turn}`)),
  reasoning: (text) => stream("reasoning", text),
  text: (text) => stream("text", text),
  command: (_id, command) => line(styleText("bold", `$ ${command}`)),
  approve: (_id, command, reason) => ask(`Grok wants to run ${command}, which needs approval because ${reason}. Run it? [y/N] `),
  result: (_id, result) => {
    const output = `${result.stdout}${result.stderr}`.trimEnd();
    const lines = output ? output.split("\n") : [];
    for (const text of lines.slice(0, SHOWN_LINES)) line(styleText(result.denied ? "red" : "dim", `  ${text}`));
    if (lines.length > SHOWN_LINES) line(styleText("dim", `  and ${lines.length - SHOWN_LINES} more lines`));
    if (result.timedOut) line(styleText("red", "  Timed out"));
    else if (result.exitCode && !result.denied) line(styleText("red", `  Exit code ${result.exitCode}`));
  },
  write: (_id, path, error) => line(error ? styleText("red", `Couldn't write ${path}: ${error}`) : styleText("green", `Wrote ${path}`)),
  usage: (usage) => {
    const cached = usage.inputTokens ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0;
    line(styleText("dim", `  ${usage.inputTokens.toLocaleString()} tokens in, ${cached}% cached, ${usage.outputTokens.toLocaleString()} out, $${usage.cost.toFixed(4)}`));
  },
  compacted: (compaction) => line(styleText("cyan", `Compacted ${compaction.messages} messages, ${compaction.tokens.toLocaleString()} tokens, into one item for $${compaction.cost.toFixed(4)}`)),
  verified: (result) => line(styleText(result.exitCode === 0 ? "green" : "red", `\nRan node --test to check: ${result.exitCode === 0 ? "every test passes" : "some tests fail"}`)),
});

line(`\n${styleText("bold", fix.finished ? "Grok's summary" : "Stopped")}`);
line(fix.summary);
if (fix.changes.length) {
  line(styleText("bold", `\n${fix.changes.length === 1 ? "1 file" : `${fix.changes.length} files`} changed`));
  for (const change of fix.changes) {
    for (const text of change.patch.trimEnd().split("\n")) {
      line(text.startsWith("+") ? styleText("green", text) : text.startsWith("-") ? styleText("red", text) : text.startsWith("@@") ? styleText("cyan", text) : text);
    }
  }
  line(`\nSaved ${fix.dir}/fix.patch. The fixed repo is in ${fix.dir}/repo.`);
} else {
  line("\nNo files changed.");
}
line(styleText("dim", `${fix.turns} turns in ${Math.round((Date.now() - started) / 1000)} seconds, for $${fix.cost.toFixed(2)}`));

// Asks on the terminal. Anything but yes counts as no, and so does input that ends before an answer.
async function ask(question: string): Promise<boolean> {
  line();
  if (process.stdin.readableEnded) {
    line(styleText("yellow", `${question}No answer, so no.`));
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new AbortController();
  prompt.once("close", () => closed.abort());
  try {
    return /^y/i.test(await prompt.question(styleText("yellow", question), { signal: closed.signal }));
  } catch {
    line(styleText("yellow", "No answer, so no."));
    return false;
  } finally {
    prompt.close();
  }
}
