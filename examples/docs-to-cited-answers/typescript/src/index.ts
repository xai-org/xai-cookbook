import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs, styleText } from "node:util";
import { type Answer, DEFAULT_FILTER, DEFAULT_QUESTION, answer, loadCollection } from "./answers.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { filter: { type: "string", default: DEFAULT_FILTER } } });
const question = positionals.join(" ") || DEFAULT_QUESTION;
const filter = values.filter;

const collection = await loadCollection();
console.log(styleText("bold", question));
console.log(styleText("dim", `Searching ${collection.collection_name}${filter ? ` where ${filter}` : ", all documents"}`));

let writing = false;
const result = await answer(question, filter, collection, {
  passages: (passages) => {
    for (const passage of passages) {
      console.log(styleText("dim", `  [${passage.number}] ${passage.filename}${passage.page ? `, page ${passage.page}` : ""}, score ${passage.score.toFixed(2)}: ${passage.text.replace(/\s+/g, " ").slice(0, 80)}…`));
    }
    if (passages.length) console.log(styleText("dim", "\nGrok is reading the passages"));
  },
  text: (text) => {
    if (!writing) process.stdout.write("\n");
    writing = true;
    process.stdout.write(text);
  },
});

console.log(result.found ? "" : `\n${result.text}`);
if (result.quotes.length) console.log();
for (const quote of result.quotes) {
  const mark = quote.checked ? styleText("green", "✓") : styleText("red", "✗ not in the passage:");
  console.log(styleText("dim", `${mark} [${quote.passage}] "${quote.quote}"`));
}
console.log(styleText("dim", `\nGrok read and wrote ${result.tokens.toLocaleString("en")} tokens, for $${result.cost.toFixed(4)}`));

const path = `output/answers/${slugify(question)}.md`;
await mkdir("output/answers", { recursive: true });
await writeFile(path, toMarkdown(question, filter, result));
console.log(styleText("dim", `Saved ${path}`));

function toMarkdown(question: string, filter: string, result: Answer): string {
  const quotes = result.quotes.map((quote) => `- [${quote.passage}] "${quote.quote}"${quote.checked ? "" : " (not in the passage)"}`);
  const passages = result.passages.map(
    (passage) => `### [${passage.number}] ${passage.filename}${passage.page ? `, page ${passage.page}` : ""}\n\nScore ${passage.score.toFixed(2)}. ${Object.entries(passage.fields).map(([key, value]) => `${key}: ${value}`).join(", ")}\n\n${passage.text}`,
  );
  return `# ${question}\n\nFilter: ${filter ? `\`${filter}\`` : "none"}\n\n${result.text}\n\n## Quotes\n\n${quotes.join("\n") || "None"}\n\n## Passages\n\n${passages.join("\n\n") || "None"}\n`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer";
}
