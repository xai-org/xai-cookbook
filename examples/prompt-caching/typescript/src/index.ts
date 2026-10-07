import { styleText } from "node:util";
import type { Turn } from "./chat.ts";
import { CHATS, type ChatKey, SCRIPT, compare, saveResults, summarize } from "./compare.ts";

// Pass a number to play only that many turns of the script, for a quicker and cheaper run.
const script = SCRIPT.slice(0, Number(process.argv[2]) || SCRIPT.length);
const width = Math.max(...Object.values(CHATS).map((chat) => chat.name.length));
const label = (key: ChatKey) => CHATS[key].name.padEnd(width);

console.log(styleText("bold", `Playing ${script.length} scripted turns in three chats at once`));
for (const chat of Object.values(CHATS)) console.log(styleText("dim", `  ${chat.name.padEnd(width)}  ${chat.about}`));
console.log(styleText("dim", "\nEach finished turn shows its input tokens, the share read from the cache, its cost, and the time to its first token.\n"));

const started = Date.now();
const results = await compare(script, {
  answer: (key, index, turn) => console.log(styleText("dim", `${label(key)}  turn ${String(index + 1).padStart(2)}  ${describe(turn)}`)),
  compacted: (key, index, compaction) =>
    console.log(
      `${label(key)}  compacted ${compaction.messages} messages after turn ${index + 1}: ${compaction.input_tokens.toLocaleString("en")} tokens in, ${compaction.output_tokens.toLocaleString("en")} out, ${dollars(compaction.cost.total)}, ${seconds(compaction.total_ms)}`,
    ),
  failed: (key, error) => console.log(styleText("red", `${label(key)}  stopped: ${error.message}`)),
});
const path = await saveResults(results);

console.log(`\n${styleText("bold", `${"".padEnd(width)}  ${"Cost".padEnd(8)}  Cached  First token  Compactions`)}`);
let total = 0;
for (const [key, turns] of Object.entries(results) as Array<[ChatKey, Turn[]]>) {
  const summary = summarize(turns);
  total += summary.cost;
  console.log(
    `${label(key)}  ${dollars(summary.cost).padEnd(8)}  ${percent(summary.cached).padStart(6)}  ${seconds(summary.first_token_ms).padStart(11)}  ${String(summary.compactions).padStart(11)}`,
  );
}
console.log(`\nThe run took ${Math.round((Date.now() - started) / 1000)} seconds and cost ${dollars(total)} at list price.`);

const base = summarize(results.message);
for (const key of ["top", "compaction"] as const) {
  const summary = summarize(results[key]);
  if (base.turns === script.length && summary.turns === script.length) {
    console.log(styleText("bold", `"${CHATS[key].name}" cost ${(summary.cost / base.cost).toFixed(1)} times as much as "${CHATS.message.name}".`));
  }
}
console.log(`Saved every turn to ${path}`);

function describe(turn: Turn): string {
  const cached = `${percent(turn.cached_tokens / turn.input_tokens).padStart(4)} cached`;
  return `${turn.input_tokens.toLocaleString("en").padStart(6)} in, ${cached}  ${dollars(turn.cost.total)}  ${seconds(turn.first_token_ms)}`;
}

function dollars(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
