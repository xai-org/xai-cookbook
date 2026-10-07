import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { buffer } from "node:stream/consumers";
import { BATCH_MODEL, readInBatch } from "./batch.ts";
import { MODEL, type ReceiptEvents, checkReceipt, readReceipts } from "./receipts.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLES = new URL("../samples/", import.meta.url);
const SAMPLE_NAMES = await readdir(SAMPLES);
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const uploads = new Map<string, { name: string; file: Blob }>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  const sample = url.pathname.match(/^\/samples\/([\w.-]+)$/)?.[1];
  if (sample && SAMPLE_NAMES.includes(sample)) return reply(res, 200, TYPES[extname(sample)], await readFile(new URL(sample, SAMPLES)));
  if (url.pathname === "/api/receipts" && req.method === "POST") return saveReceipt(req, res, url.searchParams.get("name") || "receipt");
  if (url.pathname === "/api/read") return streamRead(url.searchParams.get("ids") ?? "", url.searchParams.get("batch") === "1", res);
  if (url.pathname === "/api/check" && req.method === "POST") return check(req, res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page uploads each receipt here first and then opens the
// event stream with the ids it gets back.
async function saveReceipt(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  // A request without one is turned away too.
  if (!(Number(req.headers["content-length"]) <= MAX_FILE_BYTES)) {
    return reply(res, 413, "text/plain", "A receipt can be at most 10 MB.");
  }
  try {
    const bytes = await buffer(req);
    const type = fileType(bytes);
    if (!type) return reply(res, 415, "text/plain", "Receipts have to be JPEG, PNG, or WebP photos, or PDFs.");
    const id = randomUUID();
    uploads.set(id, { name: basename(name), file: new Blob([bytes], { type }) });
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    // The page went away mid-upload. Left unhandled, the rejection would stop the server.
    res.destroy();
  }
}

// Reads the receipts while streaming each step to the page as server-sent events.
async function streamRead(ids: string, batch: boolean, res: ServerResponse): Promise<void> {
  // Each upload is read once, so a reconnecting EventSource can't start a second run.
  const files = ids.split(",").map((id) => {
    const upload = uploads.get(id);
    uploads.delete(id);
    return upload;
  });
  if (files.some((file) => !file)) return reply(res, 404, "text/plain", "The receipts are gone. Add them again.");

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A receipt can finish after another one has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed or stopped before every receipt is read.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const started = Date.now();
  const on: ReceiptEvents = {
    start: (index) => emit("start", { index }),
    // The page fills the cells from the first read and shows its reasoning, so the second read's are left out.
    reasoning: (index, read, text) => read === 1 && emit("reasoning", { index, text }),
    partial: (index, read, receipt) => read === 1 && emit("partial", { index, receipt }),
    retry: (index, read, problems) => emit("retry", { index, read, problems }),
    read: (index, read) => emit("read", { index, read }),
    row: (index, row) => emit("row", { index, ...row }),
    // Not "error", which EventSource also fires when the connection drops.
    error: (index, error) => {
      console.error(`Couldn't read ${files[index]?.name}: ${error.message}`);
      emit("unreadable", { index, message: error.message });
    },
  };
  try {
    const receipts = files as Array<{ name: string; file: Blob }>;
    emit("model", { model: batch ? BATCH_MODEL : MODEL });
    const rows = batch
      ? await readInBatch(
          receipts,
          { ...on, created: (id) => emit("batch", { id }), progress: (done, total) => emit("progress", { done, total }) },
          abort.signal,
        )
      : await readReceipts(receipts, on, abort.signal);
    const cost = rows.reduce((sum, row) => sum + (row?.cost ?? 0), 0);
    emit("done", { cost, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

// Runs the checks again on a receipt someone edited in the page.
async function check(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(Number(req.headers["content-length"]) <= 256 * 1024)) return reply(res, 413, "text/plain", "That receipt is too big.");
  try {
    const receipt = JSON.parse((await buffer(req)).toString());
    reply(res, 200, "application/json", JSON.stringify({ problems: checkReceipt(receipt) }));
  } catch {
    if (!res.headersSent) reply(res, 400, "text/plain", "Send the receipt as JSON.");
  }
}

// Checks the first bytes, because the type a browser sends comes from the file name.
function fileType(bytes: Buffer): string | undefined {
  const head = bytes.toString("latin1", 0, 12);
  if (head.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (head.startsWith("RIFF") && head.slice(8) === "WEBP") return "image/webp";
  if (head.startsWith("%PDF-")) return "application/pdf";
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
