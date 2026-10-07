import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { BATCH_MODELS, DEFAULT_MODEL, MODELS, type Result, type Review, type RunEvents, analyze, cancel, loadRun, readReviews, resume } from "./themes.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-reviews.csv", import.meta.url);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const RUN_ID = /^[\w-]+$/;
const uploads = new Map<string, { name: string; reviews: Review[] }>();
// The runs in progress, so Stop can reach the one it's for.
const running = new Map<string, AbortController>();
// The URL and path of every file a run has saved. The server serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/sample") return reply(res, 200, "application/json", JSON.stringify({ name: "sample-reviews.csv", rows: (await readSample()).length }));
  if (url.pathname === "/api/uploads" && req.method === "POST") return saveUpload(req, res, url.searchParams.get("name") || "reviews.csv");
  if (url.pathname === "/api/run") return streamRun(url.searchParams, res);
  if (url.pathname === "/api/saved") return describeRun(url.searchParams.get("run") ?? "", res);
  if (url.pathname === "/api/stop" && req.method === "POST") return stopRun(url.searchParams.get("run") ?? "", res);

  const path = files.get(url.pathname);
  if (path) return reply(res, 200, path.endsWith(".csv") ? "text/csv; charset=utf-8" : "application/json", await readFile(path));
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

async function readSample(): Promise<Review[]> {
  return readReviews(await readFile(SAMPLE, "utf8"));
}

// EventSource can only make GET requests, so the page uploads a CSV here first and then opens the event stream
// with the id it gets back.
async function saveUpload(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  if (!(Number(req.headers["content-length"]) <= MAX_UPLOAD_BYTES)) return reply(res, 413, "text/plain", "The CSV can be at most 10 MB.");
  try {
    const reviews = readReviews((await buffer(req)).toString("utf8"));
    if (!reviews.length) throw new Error("The CSV has no reviews in it.");
    const id = randomUUID();
    uploads.set(id, { name, reviews });
    reply(res, 200, "application/json", JSON.stringify({ id, name, rows: reviews.length }));
  } catch (error) {
    reply(res, 400, "text/plain", error instanceof Error ? error.message : String(error));
  }
}

// Runs or resumes a run while streaming each step to the page as server-sent events.
async function streamRun(params: URLSearchParams, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A labeling request can still finish after another step has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop waiting and stop making API calls if the page is closed. A batch keeps running at SpaceXAI, so the page
  // can pick it up again later.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const resuming = params.get("resume");
  const id = resuming ?? randomUUID().slice(0, 8);
  const dir = `output/${id}`;
  running.set(id, abort);
  const on: RunEvents = {
    step: (step) => emit("step", { step }),
    reasoning: (text) => emit("reasoning", { text }),
    candidate: (candidate) => emit("candidate", candidate),
    batch: (batch) => emit("batch", batch),
    progress: (progress) => emit("progress", progress),
    labels: (labels) => emit("labels", { labels }),
    failed: (message) => {
      console.error(`A labeling request failed: ${message}`);
      emit("warning", { message });
    },
    cost: (cost) => emit("cost", { cost }),
  };

  try {
    let result: Result;
    if (resuming) {
      const run = RUN_ID.test(resuming) ? await loadRun(dir) : undefined;
      if (!run?.batch || run.finished) throw new Error("That batch is no longer waiting to be picked up.");
      emit("run", { id, source: run.source, model: run.model, mode: run.mode, reviews: run.reviews, started: run.started });
      result = await resume(dir, on, abort.signal);
    } else {
      const source = params.get("source") ?? "sample";
      const upload = uploads.get(source);
      // Each upload makes one run, so a reconnecting EventSource can't start a second one.
      uploads.delete(source);
      if (source !== "sample" && !upload) throw new Error("The CSV is gone. Choose it again.");
      const { name, reviews } = upload ?? { name: "sample-reviews.csv", reviews: await readSample() };
      const model = MODELS.find((known) => known === params.get("model")) ?? DEFAULT_MODEL;
      const mode = params.get("mode") === "live" || !BATCH_MODELS.includes(model) ? "live" : "batch";
      emit("run", { id, source: name, model, mode, reviews, started: new Date().toISOString() });
      result = await analyze(dir, name, reviews, model, mode, on, abort.signal);
    }
    emit("done", { ...result, files: { csv: publish(id, `${dir}/reviews.csv`), json: publish(id, `${dir}/themes.json`) } });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    running.delete(id);
  }
  res.end();
}

// Tells the page about a saved batch it can pick up, after the page was closed or the server restarted.
async function describeRun(id: string, res: ServerResponse): Promise<void> {
  const run = RUN_ID.test(id) ? await loadRun(`output/${id}`) : undefined;
  if (!run?.batch || run.finished) return reply(res, 404, "text/plain", "There's no batch waiting for that run.");
  reply(res, 200, "application/json", JSON.stringify({ source: run.source, model: run.model, rows: run.reviews.length, started: run.started, batch: run.batch.id }));
}

// Stops a run, and cancels its batch so the requests that haven't run yet aren't billed.
async function stopRun(id: string, res: ServerResponse): Promise<void> {
  running.get(id)?.abort();
  try {
    const cancelled = RUN_ID.test(id) && (await cancel(`output/${id}`));
    reply(res, 200, "application/json", JSON.stringify({ cancelled }));
  } catch (error) {
    reply(res, 500, "text/plain", error instanceof Error ? error.message : String(error));
  }
}

function publish(id: string, path: string): string {
  const url = `/files/${id}/${path.split("/").pop()}`;
  files.set(url, path);
  return url;
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
