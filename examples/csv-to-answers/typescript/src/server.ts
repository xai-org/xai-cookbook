import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { DEFAULT_QUESTION, SAMPLE, ask, safeFilename, uploadCsv } from "./answers.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const MAX_CSV_BYTES = 2 * 1024 * 1024;
// Uploads delete themselves after an hour, so one that's nearly that old is uploaded again first.
const UPLOAD_LIFETIME_MS = 50 * 60 * 1000;
const datasets = new Map<string, { filename: string; file: Blob; fileId?: string; uploadedAt?: number }>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/subscriptions.csv") return reply(res, 200, "text/csv; charset=utf-8", await readFile(SAMPLE));
  if (url.pathname === "/api/datasets" && req.method === "POST") return saveDataset(req, url.searchParams.get("name") ?? "", res);
  if (url.pathname === "/api/answer") return answer(url.searchParams.get("dataset") ?? "", url.searchParams.get("question") || DEFAULT_QUESTION, res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page sends the CSV here first and then asks each
// question with the id it gets back.
async function saveDataset(req: IncomingMessage, name: string, res: ServerResponse): Promise<void> {
  // Node reads exactly content-length bytes of body, so checking the header enforces the limit.
  if (!(Number(req.headers["content-length"]) <= MAX_CSV_BYTES)) {
    return reply(res, 413, "text/plain", "Choose a CSV of 2 MB or less.");
  }
  try {
    const bytes = await buffer(req);
    // Spreadsheet files like .xlsx are binary, with zero bytes in them, which a CSV never has.
    if (!bytes.length || bytes.includes(0)) return reply(res, 415, "text/plain", "Choose a CSV file.");
    const id = randomUUID();
    datasets.set(id, { filename: safeFilename(name), file: new Blob([bytes], { type: "text/csv" }) });
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    // The page went away mid-upload. Left unhandled, the rejection would stop the server.
    res.destroy();
  }
}

// Answers the question while streaming each step to the page as server-sent events.
async function answer(datasetId: string, question: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop the upload or the answer if the page is closed or the question is stopped.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const dataset = datasets.get(datasetId);
    if (!dataset) throw new Error("The CSV is gone. Choose it again.");
    if (!dataset.fileId || Date.now() - (dataset.uploadedAt ?? 0) > UPLOAD_LIFETIME_MS) {
      emit("step", { step: "upload", filename: dataset.filename });
      dataset.fileId = await uploadCsv(dataset.file, dataset.filename, abort.signal);
      dataset.uploadedAt = Date.now();
    }
    emit("step", { step: "think", filename: dataset.filename, fileId: dataset.fileId });
    const result = await ask(
      { fileId: dataset.fileId, filename: dataset.filename },
      question,
      {
        reasoning: (text) => emit("reasoning", { text }),
        code: (index, code) => emit("code", { index, code }),
        output: (index, run) => emit("output", { index, ...run }),
        draft: (draft) => emit("draft", draft),
      },
      abort.signal,
    );
    const { runs, ...answer } = result;
    emit("done", { ...answer, runs: runs.length });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
