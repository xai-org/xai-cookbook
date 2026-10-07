import { openAsBlob } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { styleText } from "node:util";
import { BATCH_MODEL, readInBatch } from "./batch.ts";
import { MODEL, type Row, decimals, readReceipts } from "./receipts.ts";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

const args = process.argv.slice(2);
const batch = args.includes("--batch");
const paths = args.filter((arg) => arg !== "--batch");
const files = paths.length ? paths : (await readdir("samples")).sort().map((name) => `samples/${name}`);
const receipts = await Promise.all(
  files.map(async (path) => ({ name: basename(path), file: await openAsBlob(path, { type: TYPES[extname(path).toLowerCase()] }) })),
);
const width = Math.max(...receipts.map((receipt) => receipt.name.length));

const started = Date.now();
let rows: Array<Row | undefined>;
if (batch) {
  console.log(styleText("bold", `Reading ${receipts.length} receipts twice each with the Batch API and ${BATCH_MODEL}`));
  let reported = -1;
  rows = await readInBatch(receipts, {
    created: (id) => console.log(styleText("dim", `Batch ${id}. Most finish in minutes, but a batch can take up to a day.`)),
    progress: (done, total) => {
      if (done !== reported) console.log(styleText("dim", `  ${done} of ${total} reads done`));
      reported = done;
    },
    row: (index, row) => console.log(describe(receipts[index].name, row)),
    error: (index, error) => console.log(`${receipts[index].name.padEnd(width)}  ${styleText("red", `couldn't read it: ${error.message}`)}`),
  });
} else {
  console.log(styleText("bold", `Reading ${receipts.length} receipts twice each with ${MODEL}`));
  rows = await readReceipts(receipts, {
    retry: (index, read, problems) =>
      console.log(styleText("dim", `${receipts[index].name}: read ${read} didn't check out, so Grok is looking again. ${problems}`)),
    row: (index, row) => console.log(describe(receipts[index].name, row)),
    error: (index, error) => console.log(`${receipts[index].name.padEnd(width)}  ${styleText("red", `couldn't read it: ${error.message}`)}`),
  });
}

await mkdir("output", { recursive: true });
await writeFile("output/receipts.csv", toCsv(rows));
await writeFile("output/receipts.json", JSON.stringify(rows.map((row, index) => ({ file: receipts[index].name, ...row })), null, 2));

const read = rows.filter((row) => row !== undefined);
const clean = read.filter((row) => !row.problems.length && !row.disagreements.length).length;
const retries = read.reduce((sum, row) => sum + row.retries, 0);
const cost = read.reduce((sum, row) => sum + row.cost, 0);
console.log(`\nSaved output/receipts.csv and output/receipts.json`);
console.log(
  `${plural(receipts.length, "receipt")}: ${clean} check out, ${read.length - clean} to review` +
    `${read.length < receipts.length ? `, ${receipts.length - read.length} couldn't be read` : ""}. ` +
    `${plural(retries, "retry", "retries")}, ${Math.round((Date.now() - started) / 1000)} seconds, $${cost.toFixed(2)}.`,
);

function describe(name: string, row: Row): string {
  const { receipt } = row;
  const total = receipt.total.toFixed(decimals(receipt.currency));
  const columns = `${name.padEnd(width)}  ${receipt.vendor.slice(0, 24).padEnd(24)}  ${receipt.date}  ${receipt.currency}  ${total.padStart(10)}`;
  const notes = reviewNotes(row);
  return `${columns}  ${notes.length ? styleText("yellow", `review: ${notes.join("; ")}`) : styleText("green", "checks out")}`;
}

// What a person should look at: the checks the row fails, and the fields the two reads disagree on.
function reviewNotes(row: Row): string[] {
  const values = (pair: [unknown, unknown]) => pair.map((value) => (value === null ? "nothing" : String(value))).join(" or ");
  return [
    ...row.problems.map((problem) => `${problem.path}: ${problem.message}`),
    ...row.disagreements.map((disagreement) => `the reads disagree on ${disagreement.path} (${values(disagreement.values)})`),
  ];
}

function toCsv(rows: Array<Row | undefined>): string {
  const header = ["file", "vendor", "date", "currency", "subtotal", "tax", "tax_included", "tip", "total", "items", "status", "notes"];
  const lines = rows.map((row, index) => {
    if (!row) return [receipts[index].name, "", "", "", "", "", "", "", "", "", "unread", ""];
    const { receipt } = row;
    const notes = reviewNotes(row);
    return [
      receipts[index].name,
      receipt.vendor,
      receipt.date,
      receipt.currency,
      receipt.subtotal,
      receipt.tax,
      receipt.tax_included,
      receipt.tip,
      receipt.total,
      receipt.line_items.map((item) => item.description).join("; "),
      notes.length ? "review" : "checks out",
      notes.join("; "),
    ];
  });
  return [header, ...lines].map((line) => line.map(csvField).join(",")).join("\n") + "\n";
}

function csvField(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
