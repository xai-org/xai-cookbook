import { randomUUID } from "node:crypto";
import { type CreateParams, type InputItem, SpaceXAI } from "@xai-official/sdk";
import { z } from "zod";

// Several receipts are read at once, so a request now and then fails before Grok answers, for example when
// the API is busy. retryBeforeOutput tries those again, which is safe because nothing has been streamed yet,
// and a few more retries than the default ride out a rate limit.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

export const MODEL = "grok-4.7";
// A read that fails the checks gets one more look at the receipt.
const ATTEMPTS = 2;
const CONCURRENCY = 3;
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

const LineItem = z.object({
  description: z.string().describe("The item's name as printed, in the receipt's language, without its quantity or price"),
  quantity: z.number().describe("1 when no quantity is printed. The weight for items sold by weight"),
  unit_price: z.number().nullable().describe("The price of one, or null when only the line's amount is printed"),
  amount: z.number().describe("The line's amount. Negative for discounts"),
});

const ReceiptFields = z.object({
  vendor: z.string().describe("The business that issued it"),
  date: z.iso.date().describe("The purchase or invoice date"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((code) => CURRENCIES.has(code), { error: (issue) => `${issue.input} isn't an ISO 4217 currency code` })
    .describe("The ISO 4217 code, like USD or SEK"),
  line_items: z.array(LineItem),
  subtotal: z.number().describe("The line items added up, before any tax that's added on top"),
  tax: z.number().describe("All the tax, such as sales tax, VAT, or GST. 0 if none is shown"),
  tax_included: z.boolean().describe("Whether the line items already include the tax, as with VAT in most of Europe"),
  tip: z.number().describe("0 unless a tip is printed or written in"),
  total: z.number().describe("The amount paid, including any tip"),
});

export const Receipt = ReceiptFields.superRefine(checkTotals);
export type Receipt = z.infer<typeof Receipt>;
export type Material = { type: "input_image"; image: Blob; detail: "high" } | { type: "input_file"; file_id: string };
export type Problem = { path: string; message: string };
export type Disagreement = { path: string; values: [unknown, unknown] };
// One read of a receipt, with the problems it still has after its last attempt.
export type Read = { receipt: Receipt; problems: Problem[]; attempts: number; cost: number };
export type Row = {
  receipt: Receipt;
  // The read the row shows. Where the reads disagree, it's the one with fewer problems.
  shown: 1 | 2;
  problems: Problem[];
  disagreements: Disagreement[];
  retries: number;
  cost: number;
};

export type ReceiptEvents = {
  start?: (index: number) => void;
  reasoning?: (index: number, read: number, text: string) => void;
  // The receipt so far, with whatever is still being written closed off. It isn't validated.
  partial?: (index: number, read: number, receipt: unknown) => void;
  retry?: (index: number, read: number, problems: string) => void;
  read?: (index: number, read: number) => void;
  row?: (index: number, row: Row) => void;
  error?: (index: number, error: Error) => void;
};

type ReadEvents = { reasoning: (text: string) => void; partial: (receipt: unknown) => void; retry: (problems: string) => void };

const PROMPT = `You read receipts and invoices into a spreadsheet. Copy what's printed: don't correct the receipt's math or fill in what isn't there.
- Dates like 03/09/2026 follow the convention of the receipt's country: day first in the UK and most of the world, month first in the US.
- Work out the currency from the symbol, the country, and the language, like kr on a Swedish receipt being SEK.
- List every line that adds to or takes away from the total, in order, including discounts, deposits, and fees. Leave out tax, tips, subtotals, and payment lines.
- Write amounts as plain numbers, whatever the receipt's number format: 1.200,00 is 1200, and ¥1,200 is 1200.
- The cash handed over and the change aren't the total.`;

const RETRY = "Look at the receipt again and fix anything you misread. If the receipt really says what you wrote, keep it as printed.";

// The API constrains Grok's output to this JSON Schema. Zod's refinements can't be expressed in it, so
// toJson(Receipt) runs them afterward.
const FORMAT = { type: "json_schema", name: "receipt", schema: z.toJSONSchema(Receipt) } as const;

const FIELDS = ["vendor", "date", "currency", "subtotal", "tax", "tax_included", "tip", "total"] as const;
const ITEM_FIELDS = ["description", "quantity", "unit_price", "amount"] as const;

// Photos go into the request as images. PDFs go through the Files API, and each upload deletes itself
// after an hour.
export async function prepare(file: Blob, filename: string, signal?: AbortSignal): Promise<Material> {
  if (file.type !== "application/pdf") return { type: "input_image", image: file, detail: "high" };
  const uploaded = await client.files.upload({ file, filename, expires_after: 3600 }, { signal });
  return { type: "input_file", file_id: uploaded.id };
}

// The request for one read, which batch mode sends too.
export function readRequest(model: string, material: Material): CreateParams & { input: InputItem[] } {
  return {
    model,
    input: [
      { role: "system", content: PROMPT },
      { role: "user", content: [material, { type: "input_text", text: "Read this receipt." }] },
    ],
    text: { format: FORMAT },
    // Receipts are short, and the checks catch the misreads that more reasoning would, so low effort is
    // enough. At the default, a read takes about three times as long.
    reasoning: { effort: "low" },
  };
}

// Reads every receipt, a few at a time, reporting each step as it happens. A receipt that can't be read is
// reported with its error, and the others carry on.
export async function readReceipts(
  files: Array<{ name: string; file: Blob }>,
  on: ReceiptEvents = {},
  signal?: AbortSignal,
): Promise<Array<Row | undefined>> {
  const run = limit(CONCURRENCY);
  return Promise.all(
    files.map((file, index) =>
      run(async () => {
        try {
          on.start?.(index);
          const row = await readReceipt(await prepare(file.file, file.name, signal), index, on, signal);
          on.row?.(index, row);
          return row;
        } catch (error) {
          if (signal?.aborted) throw error;
          on.error?.(index, error instanceof Error ? error : new Error(String(error)));
          return undefined;
        }
      }),
    ),
  );
}

// grok-4.7 doesn't return logprobs, so confidence comes from two independent reads made at the same time:
// where Grok is unsure of a value, the reads tend to differ.
async function readReceipt(material: Material, index: number, on: ReceiptEvents, signal?: AbortSignal): Promise<Row> {
  // A retry repeats the receipt, so sharing a cache key lets it come from the prompt cache.
  const cacheKey = randomUUID();
  const [first, second] = await Promise.all(
    [1, 2].map(async (read) => {
      const result = await readOnce(
        material,
        cacheKey,
        {
          reasoning: (text) => on.reasoning?.(index, read, text),
          partial: (receipt) => on.partial?.(index, read, receipt),
          retry: (problems) => on.retry?.(index, read, problems),
        },
        signal,
      );
      on.read?.(index, read);
      return result;
    }),
  );
  return compareReads(first, second);
}

// Streams one read and validates it with toJson(Receipt). If it fails, the problems go back to Grok with
// the conversation so far, and it gets one more look. A read that still fails is kept with its problems.
async function readOnce(material: Material, cacheKey: string, on: ReadEvents, signal?: AbortSignal): Promise<Read> {
  const request = readRequest(MODEL, material);
  const input = [...request.input];
  let cost = 0;
  for (let attempt = 1; ; attempt++) {
    const stream = await client.responses.create(
      { ...request, input, prompt_cache_key: cacheKey, stream: true },
      // Streamed requests wait as long as reasoning takes unless given an idle timeout. At low effort, a
      // read that sends nothing for a minute has stalled.
      { signal, idleTimeout: 60_000 },
    );
    const response = await stream.on("reasoning", on.reasoning).on("json", on.partial).done();
    cost += response.usage.cost_usd ?? 0;
    try {
      return { receipt: response.toJson(Receipt), problems: [], attempts: attempt, cost };
    } catch (error) {
      if (attempt === ATTEMPTS) {
        const receipt = response.toJson() as Receipt;
        return { receipt, problems: checkReceipt(receipt), attempts: attempt, cost };
      }
      const problems = error instanceof Error ? error.message : String(error);
      on.retry(problems);
      input.push(...response.toInput(), { role: "user", content: `${problems}\n\n${RETRY}` });
    }
  }
}

// Shows the read with fewer problems, and lists every field where the two reads differ.
export function compareReads(first: Read, second: Read): Row {
  const shown = second.problems.length < first.problems.length ? 2 : 1;
  const [read, other] = shown === 1 ? [first, second] : [second, first];
  return {
    receipt: read.receipt,
    shown,
    problems: read.problems,
    disagreements: findDisagreements(read.receipt, other.receipt, shown),
    retries: first.attempts + second.attempts - 2,
    cost: first.cost + second.cost,
  };
}

// Paths point into the shown read, and values are in read order. A line only the other read found has no
// cell to mark, so it's listed under line_items as a whole.
function findDisagreements(shown: Receipt, other: Receipt, shownRead: 1 | 2): Disagreement[] {
  const found: Disagreement[] = [];
  const add = (path: string, mine: unknown, theirs: unknown) => {
    found.push({ path, values: shownRead === 1 ? [mine, theirs] : [theirs, mine] });
  };
  for (const field of FIELDS) {
    if (!same(shown[field], other[field])) add(field, shown[field], other[field]);
  }
  for (const [index, mine, theirs] of pairItems(shown.line_items, other.line_items)) {
    if (!mine) {
      add("line_items", null, `${theirs?.description} ${theirs?.amount}`);
      continue;
    }
    for (const field of ITEM_FIELDS) {
      // One read can leave out a unit price that the other works out from the amount, which is no disagreement.
      if (field === "unit_price" && theirs && same(unitPrice(mine), unitPrice(theirs))) continue;
      if (!same(mine[field], theirs?.[field] ?? null)) add(`line_items.${index}.${field}`, mine[field], theirs?.[field] ?? null);
    }
  }
  return found;
}

type LineItem = Receipt["line_items"][number];

// Pairs the two reads' line items in order, so a line that only one read found doesn't throw off the lines
// after it. Lines pair up when their names or amounts match. Each pair has the line's index in the first list.
function pairItems(a: LineItem[], b: LineItem[]): Array<[number, LineItem | undefined, LineItem | undefined]> {
  const match = (x: LineItem | undefined, y: LineItem | undefined) => !!x && !!y && (same(x.description, y.description) || same(x.amount, y.amount));
  const pairs: Array<[number, LineItem | undefined, LineItem | undefined]> = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (!match(a[i], b[j]) && match(a[i], b[j + 1])) pairs.push([i, undefined, b[j++]]);
    else if (!match(a[i], b[j]) && match(a[i + 1], b[j])) pairs.push([i, a[i++], undefined]);
    else pairs.push([i, a[i++], b[j++]]);
  }
  return pairs;
}

function unitPrice(item: LineItem): number {
  return item.unit_price ?? item.amount / item.quantity;
}

// Case, spacing, and punctuation don't count as disagreements, and amounts only count to the cent.
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  if (typeof a === "string" && typeof b === "string") return normalize(a) === normalize(b);
  return a === b;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// Runs the same checks as toJson(Receipt), for a receipt someone edited or a read that still fails them.
export function checkReceipt(value: unknown): Problem[] {
  const result = Receipt.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

// The rules a JSON Schema can't express: each line's amount is its quantity times its price, the lines add
// up to the subtotal, and the subtotal, tax, and tip add up to the total. Amounts only have to match to
// the smallest unit of the currency, since receipts round.
function checkTotals(receipt: z.output<typeof ReceiptFields>, ctx: z.RefinementCtx): void {
  const places = decimals(receipt.currency);
  const money = (amount: number) => amount.toFixed(places);
  const differ = (a: number, b: number) => Math.abs(a - b) >= 0.5 * 10 ** -places;
  const report = (path: Array<string | number>, message: string) => ctx.addIssue({ code: "custom", path, message, input: receipt });

  receipt.line_items.forEach((item, index) => {
    if (item.unit_price === null) return;
    const amount = item.quantity * item.unit_price;
    if (differ(amount, item.amount)) {
      report(["line_items", index, "amount"], `${item.quantity} × ${money(item.unit_price)} is ${money(amount)}, but the line says ${money(item.amount)}, so one of them is misread`);
    }
  });
  const items = receipt.line_items.reduce((sum, item) => sum + item.amount, 0);
  if (differ(items, receipt.subtotal)) {
    report(["subtotal"], `the line items add up to ${money(items)}, but the subtotal says ${money(receipt.subtotal)}, so a line is missing or misread`);
  }
  const total = receipt.subtotal + (receipt.tax_included ? 0 : receipt.tax) + receipt.tip;
  if (differ(total, receipt.total)) {
    const parts = receipt.tax_included ? "the subtotal and tip, with the tax already in the prices," : "the subtotal, tax, and tip";
    report(["total"], `${parts} add up to ${money(total)}, but the total says ${money(receipt.total)}, so one of them is misread`);
  }
}

// How many decimals the currency's amounts have: 2 for USD, 0 for JPY.
export function decimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
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
