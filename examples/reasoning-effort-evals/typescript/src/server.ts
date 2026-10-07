import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { BATCH_MODEL, CONCURRENCY, EFFORTS, MIN_SAVING, MODEL, TOLERANCE, runScorecard, saveScorecard } from "./scorecard.ts";
import { type Task, parseTask } from "./task.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-task.json", import.meta.url);
const MAX_TASK_BYTES = 1024 * 1024;
const tasks = new Map<string, Task>();
// The URL and path of every scorecard a run has saved. The server serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-task.json") return reply(res, 200, "application/json", await readFile(SAMPLE));
  if (url.pathname === "/api/tasks" && req.method === "POST") return saveTask(req, res);
  if (url.pathname === "/api/scorecard") return streamScorecard(url.searchParams.get("task") ?? "", url.searchParams.get("mode") === "batch", res);

  const file = files.get(url.pathname);
  if (file) return reply(res, 200, "application/json", await readFile(file));
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page posts the task here first and then opens the
// event stream with the id it gets back.
async function saveTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  if (!(Number(req.headers["content-length"]) <= MAX_TASK_BYTES)) return reply(res, 413, "text/plain", "The task can be at most 1 MB.");
  try {
    const task = parseTask(JSON.parse((await buffer(req)).toString()));
    const id = randomUUID();
    tasks.set(id, task);
    reply(res, 200, "application/json", JSON.stringify({ id, name: task.name, cases: task.cases.length }));
  } catch (error) {
    if (!res.headersSent) reply(res, 400, "text/plain", error instanceof SyntaxError ? `The task isn't valid JSON: ${error.message}` : errorMessage(error));
  }
}

// Runs the scorecard while streaming every answer and every finished setting to the page as server-sent events.
async function streamScorecard(taskId: string, batch: boolean, res: ServerResponse): Promise<void> {
  // Each task starts one run, so a reconnecting EventSource can't start a second one.
  const task = tasks.get(taskId);
  if (!task) return reply(res, 404, "text/plain", "Not found");
  tasks.delete(taskId);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // Grading can still finish after another request has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop every request, and cancel the batch, if the page is closed before the scorecard is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    emit("started", {
      name: task.name,
      model: batch ? BATCH_MODEL : MODEL,
      batch,
      efforts: EFFORTS,
      tolerance: TOLERANCE,
      minSaving: MIN_SAVING,
      concurrency: CONCURRENCY,
      fields: task.fields,
      cases: task.cases.map(({ id, input }) => ({ id, input })),
    });
    const scorecard = await runScorecard(
      task,
      { batch },
      {
        answering: (effort, caseId) => emit("answering", { effort, caseId }),
        graded: (graded) => emit("graded", graded),
        finished: (summary) => emit("finished", summary),
        rateLimited: () => emit("rate-limited", {}),
        batch: (id, done, total) => emit("batch", { id, done, total }),
        comparing: (pick, best) => emit("comparing", { pick, best }),
      },
      abort.signal,
    );
    const path = await saveScorecard(scorecard);
    const download = `/files/${randomUUID()}.json`;
    files.set(download, path);
    const { graded, ...rest } = scorecard;
    emit("done", { ...rest, saved: path, download });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: errorMessage(error) });
  }
  res.end();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
