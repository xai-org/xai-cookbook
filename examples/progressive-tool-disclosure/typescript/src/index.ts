import { mkdir, writeFile } from "node:fs/promises";
import { styleText } from "node:util";
import { type Usage, ask } from "./agent.ts";
import { QUESTIONS } from "./questions.ts";
import { SERVICES, TOOLS } from "./tools.ts";

const question = process.argv.slice(2).join(" ") || QUESTIONS[0];
console.log(styleText("bold", question));
console.log(styleText("dim", `${TOOLS.length} tools from ${SERVICES.length} services. Asking with deferred loading and with every tool up front at the same time.\n`));

const calls = new Map<string, { name: string; args: object; status?: string }>();
const loaded = new Set<string>();
const started = Date.now();
let seconds = 0;
const [deferred, upfront] = await Promise.all([
  ask(question, TOOLS, true, {
    search: (query) => console.log(styleText("dim", `Searching for "${query}"`)),
    loaded: (names) => {
      names.forEach((name) => loaded.add(name));
      console.log(styleText("dim", `  loaded ${names.join(", ")}`));
    },
    call: (id, name, args) => calls.set(id, { name, args }),
    result: (id, status, body) => {
      const call = calls.get(id);
      if (call) call.status = status;
      console.log(`${styleText("bold", call ? `${call.name} ${JSON.stringify(call.args)}` : "A call")} ${status}`);
      console.log(styleText("dim", `  ${body.slice(0, 140)}`));
    },
    text: (text) => process.stdout.write(text),
  }).then((result) => {
    seconds = (Date.now() - started) / 1000;
    console.log(styleText("dim", "\n\nWaiting for the same question with every tool up front..."));
    return result;
  }),
  // If this run fails, for example on a limit to how many tools a request can have, the answer still stands.
  ask(question, TOOLS, false).catch((error: Error) => error),
]);

console.log(`\n${styleText("bold", "Input tokens")}`);
if (upfront instanceof Error) {
  console.log(line("Deferred loading", deferred.usage, deferred.usage.input));
  console.log(`  The run with every tool up front failed: ${upfront.message}`);
} else {
  const max = Math.max(deferred.usage.input, upfront.usage.input);
  console.log(line("Deferred loading", deferred.usage, max));
  console.log(line(`All ${TOOLS.length} tools up front`, upfront.usage, max));
  console.log(`Deferred loading used ${(upfront.usage.input / deferred.usage.input).toFixed(1)}x fewer input tokens.`);
}
console.log(`The answer took ${seconds.toFixed(0)} seconds.`);

await mkdir("output", { recursive: true });
const file = `output/${question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}.json`;
const comparison = upfront instanceof Error ? { error: upfront.message } : upfront.usage;
await writeFile(file, JSON.stringify({ question, answer: deferred.answer, loaded: [...loaded], calls: [...calls.values()], deferred: deferred.usage, upfront: comparison }, null, 2));
console.log(styleText("dim", `Saved ${file}`));

function line(label: string, usage: Usage, max: number): string {
  const bar = "#".repeat(Math.max(1, Math.round((usage.input / max) * 30)));
  const requests = `${usage.requests} request${usage.requests === 1 ? "" : "s"}`;
  return `  ${label.padEnd(26)} ${bar.padEnd(31)} ${usage.input.toLocaleString("en")} in ${requests}, $${usage.cost.toFixed(3)}`;
}
