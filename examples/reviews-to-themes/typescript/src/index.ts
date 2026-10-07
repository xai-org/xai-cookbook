import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs, styleText } from "node:util";
import { BATCH_MODELS, DEFAULT_MODEL, MODELS, type Result, type RunEvents, analyze, loadRun, readReviews, resume } from "./themes.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string", default: DEFAULT_MODEL }, live: { type: "boolean", default: false }, new: { type: "boolean", default: false } },
});
const path = positionals[0] ?? "sample-reviews.csv";
const dir = `output/${basename(path, ".csv")}`;
if (!MODELS.includes(values.model)) {
  console.error(`Choose one of these models: ${MODELS.join(", ")}`);
  process.exit(1);
}

let labelingSince = 0;
const on = (model: string, mode: string): RunEvents => ({
  step: (step) => {
    if (step === "find") console.log("Finding candidate themes in a sample of the reviews with grok-4.7");
    if (step === "label") {
      labelingSince = Date.now();
      console.log(`Labeling every review with ${model}, ${mode === "batch" ? "in a batch" : "8 requests at a time"}`);
    }
    if (step === "name") console.log("\nMerging and naming the themes with grok-4.7");
  },
  candidate: (candidate) => console.log(styleText("dim", `  ${candidate.name}: ${candidate.description}`)),
  batch: (batch) => console.log(styleText("dim", `  Batch ${batch.id} reads ${batch.requests} requests from ${batch.file}. Its ID is saved in ${dir}/run.json, so if this stops, run the same command again to pick up where it left off.`)),
  progress: ({ done, total, reviews }) => process.stdout.write(`\r  ${bar(done / total)} ${done} of ${total} requests, ${reviews} reviews labeled, ${clock(Date.now() - labelingSince)} `),
  failed: (error) => console.log(styleText("dim", `\n  A request failed: ${error}`)),
});

const saved = values.new ? undefined : await loadRun(dir);
let run: { source: string; model: string; mode: string; total: number };
let result: Result;
if (saved?.batch && !saved.finished) {
  run = { source: saved.source, model: saved.model, mode: saved.mode, total: saved.reviews.length };
  console.log(`Picking up batch ${saved.batch.id} from ${dir}/run.json. It started ${clock(Date.now() - Date.parse(saved.started))} ago.`);
  result = await resume(dir, on(run.model, run.mode));
} else {
  const reviews = readReviews(await readFile(path, "utf8"));
  const mode = values.live || !BATCH_MODELS.includes(values.model) ? "live" : "batch";
  if (mode === "live" && !values.live) console.log(`${values.model} doesn't take batch requests, so it labels the reviews live.`);
  run = { source: basename(path), model: values.model, mode, total: reviews.length };
  console.log(`Read ${reviews.length} reviews from ${path}`);
  result = await analyze(dir, run.source, reviews, run.model, mode, on(run.model, mode));
}

console.log(`\n${styleText("bold", `${result.themes.length} themes in ${run.total} reviews`)}`);
result.themes.forEach((theme, index) => {
  const facts = [`${theme.rows.length} reviews`, theme.trend && `${theme.trend.label} lately`, theme.rating && `rated ${theme.rating.toFixed(1)}`].filter(Boolean);
  console.log(`${String(index + 1).padStart(2)}. ${styleText("bold", theme.name)}  ${facts.join(", ")}  ${sparkline(theme.weekly)}`);
  for (const { id, quote } of theme.quotes) console.log(styleText("dim", `    "${quote}" (row ${id})`));
});
console.log(`${result.unthemed.length} reviews matched no theme${result.unlabeled.length ? `, and ${result.unlabeled.length} couldn't be labeled` : ""}.`);

await writeFile(`${dir}/themes.md`, report(result));
console.log(`\nSaved ${dir}/themes.md, themes.json, and reviews.csv`);
console.log(`Took ${clock(result.seconds * 1000)} and cost $${result.cost.toFixed(2)}`);

function report({ themes, unthemed, weeks }: Result): string {
  const span = themes.find((theme) => theme.trend)?.trend?.weeks;
  const intro = `${run.total} reviews from ${run.source}, labeled by ${run.model} ${run.mode === "batch" ? "in a batch" : "live"}.${span ? ` Trends compare the last ${span} weeks with the ${span} before them, from ${weeks[0]} on.` : ""}`;
  const sections = themes.map((theme, index) => {
    const facts = [`${theme.rows.length} reviews (${Math.round((theme.rows.length / run.total) * 100)}%)`, theme.trend && `${theme.trend.label} lately`, theme.rating && `average rating ${theme.rating.toFixed(1)}`].filter(Boolean);
    const quotes = theme.quotes.map(({ id, quote }) => `> "${quote}" (row ${id})`).join("\n>\n");
    return `## ${index + 1}. ${theme.name}\n\n${facts.join(", ")}\n\n${theme.summary}\n\n${quotes}\n\nRows: ${theme.rows.join(", ")}`;
  });
  return `# Themes in ${run.source}\n\n${intro}\n\n${sections.join("\n\n")}\n\n## No theme\n\n${unthemed.length} reviews. Rows: ${unthemed.join(", ")}\n`;
}

function sparkline(weekly: number[]): string {
  const max = Math.max(1, ...weekly);
  return weekly.map((count) => "▁▂▃▄▅▆▇█"[Math.round((count / max) * 7)]).join("");
}

function bar(fraction: number): string {
  const filled = Math.round(fraction * 20);
  return `[${"#".repeat(filled)}${"-".repeat(20 - filled)}]`;
}

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
