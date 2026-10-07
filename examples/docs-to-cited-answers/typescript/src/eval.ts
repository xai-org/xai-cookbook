import { mkdir, readFile, writeFile } from "node:fs/promises";
import { styleText } from "node:util";
import { type Answer, type Passage, answer, loadCollection, normalize } from "./answers.ts";

// Each question names the passage that answers it: one from this file that contains these words.
// Questions the documents don't answer under their filter have no passage, and should get "not found".
type Case = { question: string; filter: string; expect: { file: string; text: string } | null };
type Result = Case & { rank: number; cited: boolean; found: boolean; tokens: number; cost: number; error?: string };

const cases = JSON.parse(await readFile("eval.json", "utf8")) as Case[];
const collection = await loadCollection();
const started = Date.now();
const run = limit(4);
let finished = 0;

console.log(`Asking ${cases.length} questions about ${collection.collection_name}, 4 at a time`);
const results = await Promise.all(
  cases.map((test) =>
    run(async (): Promise<Result> => {
      // A question whose request fails counts as a miss, so one error doesn't throw away the other answers.
      try {
        const result = await answer(test.question, test.filter, collection);
        return { ...test, ...grade(test, result), found: result.found, tokens: result.tokens, cost: result.cost };
      } catch (error) {
        return { ...test, rank: 0, cited: false, found: false, tokens: 0, cost: 0, error: error instanceof Error ? error.message : String(error) };
      } finally {
        process.stdout.write(`\r${++finished} of ${cases.length} answered`);
      }
    }),
  ),
);
console.log("\n");

console.log(styleText("dim", "     Search   Answer"));
results.forEach((result, index) => {
  const search = result.error || !result.expect ? "-" : result.rank ? `#${result.rank}` : "missed";
  const searchColor = result.error || !result.expect ? "dim" : result.rank ? "green" : "red";
  const verdict = result.error ? "failed" : result.expect ? (result.cited ? "cited it" : result.found ? "cited the wrong passage" : "said not found") : result.found ? "answered anyway" : "said not found";
  const pass = !result.error && (result.expect ? result.cited : !result.found);
  console.log(`${String(index + 1).padStart(2)}   ${styleText(searchColor, search.padEnd(7))}  ${styleText(pass ? "green" : "red", verdict.padEnd(24))} ${result.question} ${styleText("dim", result.filter || "no filter")}`);
});

const failed = results.filter((result) => result.error);
const covered = results.filter((result) => result.expect && !result.error);
const uncovered = results.filter((result) => !result.expect && !result.error);
const retrieved = covered.filter((result) => result.rank);
const cost = results.reduce((sum, result) => sum + result.cost, 0);
const tokens = results.reduce((sum, result) => sum + result.tokens, 0);
console.log(`\nSearch: ${retrieved.length} of ${covered.length} searches brought back the right passage, ${retrieved.filter((result) => result.rank === 1).length} of them as the top match.`);
console.log(`Answers: ${covered.filter((result) => result.cited).length} of ${covered.length} cited the right passage, and ${uncovered.filter((result) => !result.found).length} of ${uncovered.length} questions the documents don't answer got "not found".`);
if (failed.length) console.log(styleText("red", `Left out ${failed.length} of the questions, because their requests failed. The first error: ${failed[0].error}`));
console.log(`Took ${Math.round((Date.now() - started) / 1000)} seconds. Grok read and wrote ${tokens.toLocaleString("en")} tokens, for $${cost.toFixed(4)}.`);

await mkdir("output", { recursive: true });
await writeFile("output/eval.json", JSON.stringify(results, null, 2));
console.log(styleText("dim", "Saved output/eval.json"));

// The rank is the right passage's place in the search results, starting at 1, or 0 if the search
// didn't return it. An answer cites it if one of its checked quotes or bracketed numbers points to it.
function grade(test: Case, result: Answer): { rank: number; cited: boolean } {
  const isRight = (passage?: Passage) =>
    !!test.expect && !!passage && passage.filename === test.expect.file && normalize(passage.text).includes(normalize(test.expect.text));
  const numbers = [...result.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((match) => match[1].split(",").map(Number));
  const quoted = result.quotes.filter((quote) => quote.checked).map((quote) => quote.passage);
  return {
    rank: result.passages.findIndex(isRight) + 1,
    cited: result.found && [...numbers, ...quoted].some((number) => isRight(result.passages[number - 1])),
  };
}

// Runs at most `concurrency` tasks at a time, in the order they're added.
function limit(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
