import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { styleText } from "node:util";
import { type Chart, DEFAULT_QUESTION, type Result, ask, safeFilename, uploadCsv } from "./answers.ts";

const path = process.argv[2] ?? "subscriptions.csv";
const question = process.argv.slice(3).join(" ") || DEFAULT_QUESTION;
const filename = safeFilename(basename(path));

console.log(styleText("bold", question));
console.log(styleText("dim", `Uploading ${path} to the Files API`));
const fileId = await uploadCsv(await openAsBlob(path), filename);
const started = Date.now();
let thinking = false;
const result = await ask({ fileId, filename }, question, {
  reasoning: (text) => {
    if (!thinking) process.stdout.write(styleText("dim", "\nThinking: "));
    thinking = true;
    process.stdout.write(styleText("dim", text));
  },
  code: (index, code) => {
    thinking = false;
    console.log(`\n\n${styleText("bold", `Run ${index + 1}`)}\n${code.trimEnd()}`);
  },
  output: (_, run) => {
    const printed = [run.stdout, run.stderr].filter(Boolean).join("\n").trimEnd();
    console.log(styleText(run.exitCode ? "red" : "dim", printed.replace(/^/gm, "  > ") || "  > (printed nothing)"));
  },
});
const seconds = Math.round((Date.now() - started) / 1000);

console.log(`\n\n${result.answer}\n`);
for (const finding of result.findings) console.log(`  ${styleText("bold", finding.value)} ${finding.label}. ${styleText("dim", finding.detail)}`);
console.log(`\n${styleText("bold", result.chart.title)}`);
const width = Math.max(...result.chart.series.map((series) => series.name.length));
for (const series of result.chart.series) {
  const name = series.name.padEnd(width);
  const ends = `${format(series.values[0], result.chart)} to ${format(series.values.at(-1), result.chart)}`;
  console.log(`  ${series.name === result.chart.highlight ? styleText("bold", name) : name}  ${sparkline(series.values, result.chart)}  ${styleText("dim", ends)}`);
}

const name = slugify(question);
await mkdir("output", { recursive: true });
await writeFile(`output/${name}.md`, report(question, result));
await writeFile(`output/${name}.json`, JSON.stringify({ question, ...result }, null, 2));
const cost = result.cost === null ? "" : ` The API reported a cost of $${result.cost.toFixed(2)}.`;
console.log(`\nAnswered in ${plural(seconds, "second")} with ${plural(result.runs.length, "code run")}.${cost} Saved output/${name}.md and output/${name}.json`);

// One block character per value, on a scale shared by every series so they can be compared.
function sparkline(values: number[], chart: Chart): string {
  const all = chart.series.flatMap((series) => series.values);
  const [min, max] = [Math.min(...all), Math.max(...all)];
  return values.map((value) => "▁▂▃▄▅▆▇█"[Math.round(((value - min) / (max - min || 1)) * 7)]).join("");
}

function format(value: number | undefined, chart: Chart): string {
  if (value === undefined) return "";
  if (chart.format === "percent") return `${value}%`;
  return `${chart.format === "usd" ? "$" : ""}${value.toLocaleString("en")}`;
}

function report(question: string, result: Result): string {
  const { chart } = result;
  const findings = result.findings.map((finding) => `- **${finding.value}** ${finding.label}. ${finding.detail}`);
  const rows = chart.labels.map((label, i) => `| ${label} | ${chart.series.map((series) => format(series.values[i], chart)).join(" | ")} |`);
  const table = [`| | ${chart.series.map((series) => series.name).join(" | ")} |`, `|---|${chart.series.map(() => "---:|").join("")}`, ...rows];
  const runs = result.runs.map((run, i) => {
    const printed = [run.stdout, run.stderr].filter(Boolean).join("\n").trimEnd();
    return `### Run ${i + 1}\n\n\`\`\`python\n${run.code.trimEnd()}\n\`\`\`\n\n\`\`\`text\n${printed}\n\`\`\``;
  });
  return `# ${question}\n\n${result.answer}\n\n${findings.join("\n")}\n\n## ${chart.title}\n\n${table.join("\n")}\n\n## The code Grok ran\n\n${runs.join("\n\n")}\n`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer";
}
