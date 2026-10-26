import { styleText } from "node:util";
import { type Step, ask, memoryServerUrl } from "./ask.ts";
import { DEMO_USERS, type Who, accessToken, signIn, supabaseSettings, warmUp } from "./supabase.ts";

// npm start -- [alice|bob] "message". Each run is a new conversation, so what Grok knows comes from Postgres.
const args = process.argv.slice(2);
const who = (args[0] && Object.hasOwn(DEMO_USERS, args[0]) ? args.shift() : "alice") as Who;
const message = args.join(" ") || "What do you remember about me?";

const settings = supabaseSettings();
let serverUrl: string;
try {
  serverUrl = memoryServerUrl(settings);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { client, user } = await signIn(settings, who);
const token = await accessToken(client);
await warmUp(settings, token);
console.log(styleText("dim", `SpaceXSI reaches it at ${serverUrl}\n`));
console.log(`${styleText("bold", user.name)}: ${message}`);

const started = Date.now();
let midLine = false;
let answering = false;
const write = (text: string) => {
  process.stdout.write(text);
  midLine = !text.endsWith("\n");
};
const newLine = () => midLine && write("\n");

const reply = await ask(
  message,
  { serverUrl, accessToken: token, userId: user.id },
  {
    reasoning: (text) => write(styleText("dim", text)),
    called: (step) => {
      newLine();
      write(`${formatStep(step)}\n`);
    },
    text: (text) => {
      if (!answering) {
        newLine();
        write("\n");
        answering = true;
      }
      write(text);
    },
  },
);
console.log(`\n\n${reply.steps.length} calls to the memory server, ${Math.round((Date.now() - started) / 1000)} seconds, $${reply.cost.toFixed(4)}`);

function formatStep(step: Step): string {
  const arg = step.tool === "search_memories" ? ` "${step.arguments.query}"` : "";
  const head = styleText("cyan", `→ ${step.tool}`) + arg;
  if (step.error) return `${head} ${styleText("red", step.error)}`;
  const output = step.output as { memories?: Array<{ content: string; similarity: number }>; stored?: { content: string }; forgotten?: { content: string } };
  if (output.memories) return [head, ...(output.memories.length ? [] : [styleText("dim", "    no memories")]), ...output.memories.map((m) => styleText("dim", `    ${m.content} (${m.similarity.toFixed(2)})`))].join("\n");
  if (output.stored) return `${head} saved "${output.stored.content}"`;
  if (output.forgotten) return `${head} forgot "${output.forgotten.content}"`;
  return head;
}
