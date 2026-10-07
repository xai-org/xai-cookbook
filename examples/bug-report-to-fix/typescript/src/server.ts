import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { fixBug } from "./agent.ts";
import { ALLOWED, SAMPLE_REPO, listFiles } from "./workspace.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLES = new URL("../sample-bugs.json", import.meta.url);
const MAX_REPORT = 4000;
// Reports waiting for the page to open their event stream, by run id.
const reports = new Map<string, string>();
// Commands waiting for the page to approve or deny them, by a random token the page sends back.
const approvals = new Map<string, (approved: boolean) => void>();
// The URL and path of every patch a run has saved. The server serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/setup") return sendSetup(res);
  if (url.pathname === "/api/runs" && req.method === "POST") return saveReport(req, res);
  if (url.pathname === "/api/events") return streamFix(url.searchParams.get("run") ?? "", res);
  if (url.pathname === "/api/approvals" && req.method === "POST") return answer(req, res);
  const patch = files.get(url.pathname);
  if (patch) return reply(res, 200, "text/x-diff; charset=utf-8", await readFile(patch), { "content-disposition": 'attachment; filename="fix.patch"' });
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// What the page shows before a run: the sample bug reports, the repo's files, and the allowlist.
async function sendSetup(res: ServerResponse): Promise<void> {
  const samples = JSON.parse(await readFile(SAMPLES, "utf8"));
  reply(res, 200, "application/json", JSON.stringify({ samples, files: await listFiles(SAMPLE_REPO), allowed: ALLOWED }));
}

// EventSource can only make GET requests, so the page sends the report here first and then opens the
// event stream with the id it gets back.
async function saveReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const report = typeof body?.report === "string" ? body.report.trim() : "";
  if (!report) return reply(res, 400, "text/plain", "Describe the bug first.");
  if (report.length > MAX_REPORT) return reply(res, 413, "text/plain", `Keep the report under ${MAX_REPORT} characters.`);
  const id = randomUUID();
  reports.set(id, report);
  reply(res, 200, "application/json", JSON.stringify({ id }));
}

async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const settle = approvals.get(String(body?.token));
  if (!settle) return reply(res, 404, "text/plain", "That command isn't waiting for an answer.");
  settle(body?.approve === true);
  reply(res, 204, "text/plain", "");
}

// Fixes the bug while streaming each step to the page as server-sent events.
async function streamFix(id: string, res: ServerResponse): Promise<void> {
  // Each report starts one run, so a reconnecting EventSource can't start a second one.
  const report = reports.get(id);
  if (!report) return reply(res, 404, "text/plain", "Not found");
  reports.delete(id);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop the run if the page is closed: its requests, its commands, and any command waiting for approval.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const started = Date.now();
  try {
    const fix = await fixBug(
      report,
      {
        start: (run) => emit("start", run),
        turn: (turn) => emit("turn", { turn }),
        reasoning: (text) => emit("reasoning", { text }),
        text: (text) => emit("text", { text }),
        command: (id, command) => emit("command", { id, command }),
        approve: (id, command, reason) => askPage(id, command, reason, emit, abort.signal),
        result: (id, result) => emit("result", { id, ...result }),
        write: (id, path, error) => emit("write", { id, path, error }),
        changes: (changes) => emit("changes", { changes }),
        usage: (usage) => emit("usage", usage),
        compacted: (compaction) => emit("compacted", compaction),
        verified: (result) => emit("verified", { pass: result.exitCode === 0, output: `${result.stdout}${result.stderr}` }),
      },
      abort.signal,
    );
    let patch = null;
    if (fix.changes.length) {
      patch = `/files/${id}/fix.patch`;
      files.set(patch, join(fix.dir, "fix.patch"));
    }
    emit("done", { ...fix, patch, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

// Shows the command on the page and waits for Approve or Deny. Closing the page counts as Deny.
function askPage(
  id: string,
  command: string,
  reason: string,
  emit: (event: string, data: object) => void,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const token = randomUUID();
    const settle = (approved: boolean) => {
      approvals.delete(token);
      signal.removeEventListener("abort", deny);
      emit("answered", { id, approved });
      resolve(approved);
    };
    const deny = () => settle(false);
    approvals.set(token, settle);
    signal.addEventListener("abort", deny, { once: true });
    emit("approval", { id, token, command, reason });
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  // Node never reads a body past its Content-Length, so checking the header caps the request.
  if (!(Number(req.headers["content-length"]) <= 2 * MAX_REPORT)) return undefined;
  try {
    return JSON.parse((await buffer(req)).toString());
  } catch {
    return undefined;
  }
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, ...headers }).end(body);
}
