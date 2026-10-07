import { readFile } from "node:fs/promises";
import { styleText } from "node:util";
import { DEFAULT_COMPANY, MAX_TURNS, prepareBrief } from "./brief.ts";

const company = process.argv.slice(2).join(" ") || DEFAULT_COMPANY;
const started = Date.now();
let lookups = 0;
let writing = false;

console.log(styleText("bold", `Preparing for your call with ${company}`));
const { dropped, totals, file } = await prepareBrief(company, {
  request: (index) => {
    const turns = index === 1 ? `max_turns ${MAX_TURNS}` : "max_turns starts over";
    console.log(`\n${styleText("bold", `Request ${index}`)} ${styleText("dim", `· ${turns}`)}`);
  },
  search: (search) => console.log(`  ${styleText("blue", "SpaceXAI")}  ${search.kind}: ${search.query}`),
  lookup: (lookup) => {
    lookups++;
    const withheld = lookup.withheld ? styleText("dim", ` (${lookup.withheld.toLowerCase()} stay in your app)`) : "";
    console.log(`  ${styleText("magenta", "Your app")}  ${lookup.name}: ${lookup.summary}${withheld}`);
  },
  draft: () => {
    if (writing) return;
    writing = true;
    console.log(`  ${styleText("blue", "SpaceXAI")}  Writing the brief`);
  },
});

console.log(`\n${await readFile(file, "utf8")}`);
for (const url of dropped) console.log(styleText("dim", `Dropped a source the searches didn't return: ${url}`));
const seconds = Math.round((Date.now() - started) / 1000);
console.log(
  `Saved ${file}. ${plural(totals.requests, "request")} in ${seconds} seconds, with ${plural(totals.web_searches, "web search", "web searches")}, ` +
    `${plural(totals.x_searches, "X search", "X searches")} that fetched ${plural(totals.x_posts, "post")}, and ${plural(lookups, "CRM lookup")}.`,
);
console.log(
  `The API reported a cost of $${totals.cost.toFixed(3)}, for ${totals.input_tokens.toLocaleString("en")} input tokens ` +
    `(${totals.cached_tokens.toLocaleString("en")} of them cached), ${totals.output_tokens.toLocaleString("en")} output tokens, and the searches.`,
);

function plural(count: number, word: string, words = `${word}s`): string {
  return `${count} ${count === 1 ? word : words}`;
}
