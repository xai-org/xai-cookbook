import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { type AgentEvents, type Run, addReply, createRun, decide, getApproval, getRun, interruptedRuns, snapshot } from "./agent.ts";
import { PERSONAS, converse } from "./customer.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const STARTED_AT = new Date().toISOString();
const MAX_BODY = 64 * 1024;
// Every open page gets every event, so the queue looks the same in each tab.
const pages = new Map<string, ServerResponse>();
// The runs this process is working on, and the page that started or resumed each one, so that Stop, or
// closing that page, cancels the request in flight.
const working = new Map<string, { abort: AbortController; page?: string }>();

const events: AgentEvents = {
  run: (run) => broadcast("run", summary(run)),
  step: (run, step) => broadcast("step", { run: summary(run), step }),
  delta: (run, kind, text) => broadcast("delta", { run: run.id, kind, text }),
  approval: (approval) => broadcast("approval", approval),
  audit: (entry) => broadcast("audit", entry),
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/events") return subscribe(url.searchParams.get("page") || randomUUID(), res);
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return send(res, 400, { message: "Send a small JSON body." });
    if (url.pathname === "/api/runs") return startRun(body, res);
    const action = url.pathname.match(/^\/api\/(runs|approvals)\/([\w-]+)\/(stop|resume|reply|approve|reject)$/);
    if (action?.[1] === "runs") return controlRun(action[2], action[3], body, res);
    if (action?.[1] === "approvals" && (action[3] === "approve" || action[3] === "reject")) return decideRefund(action[2], action[3], body, res);
  }
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Open http://localhost:${PORT}`);
  // Runs that were working when the last process stopped, such as one that crashed right after a
  // refund, carry on by themselves. No page started them, so only Stop cancels them.
  for (const run of interruptedRuns()) {
    console.log(`Picking up ${run.id} from stored response ${run.response_id ?? "(none yet)"}`);
    work(run.id);
  }
});

// Each page keeps this stream open. It carries every change, and when the server goes away, the
// page's EventSource keeps trying to reconnect and gets a fresh snapshot from the new process.
function subscribe(page: string, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write("retry: 1000\n\n");
  pages.set(page, res);
  const { runs, approvals, audit } = snapshot();
  emit(res, "hello", { pid: process.pid, started_at: STARTED_AT, runs: runs.slice(-30), approvals, audit: audit.slice(-100) });
  res.on("close", () => {
    if (pages.get(page) !== res) return;
    pages.delete(page);
    // A run waiting for approval isn't working, so closing the page leaves it in the queue.
    for (const job of working.values()) if (job.page === page) job.abort.abort();
  });
}

function startRun(body: Record<string, unknown>, res: ServerResponse): void {
  const from = String(body.from ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!from || !message) return send(res, 400, { message: "Send the customer's email address and their message." });
  // A persona means Grok plays the customer and writes their replies.
  const persona = typeof body.persona === "string" && body.persona in PERSONAS ? body.persona : undefined;
  const run = createRun(from, message, events, persona);
  work(run.id, String(body.page ?? ""));
  send(res, 200, { id: run.id });
}

function controlRun(id: string, action: string, body: Record<string, unknown>, res: ServerResponse): void {
  const run = getRun(id);
  if (!run) return send(res, 404, { message: `There's no run ${id}.` });
  if (action === "stop") {
    working.get(id)?.abort.abort();
    return send(res, 200, {});
  }
  if (action === "reply") {
    const message = String(body.message ?? "").trim();
    if (!message) return send(res, 400, { message: "Write the customer's reply." });
    if (run.status !== "done") return send(res, 409, { message: `The run is ${run.status}, so the customer can't reply yet.` });
    addReply(id, message, events);
    work(id, String(body.page ?? ""));
    return send(res, 200, {});
  }
  if (action !== "resume" || !["stopped", "failed"].includes(run.status)) return send(res, 409, { message: `The run is ${run.status}.` });
  work(id, String(body.page ?? ""));
  send(res, 200, {});
}

function decideRefund(id: string, action: "approve" | "reject", body: Record<string, unknown>, res: ServerResponse): void {
  const approval = getApproval(id);
  if (!approval) return send(res, 404, { message: `There's no approval ${id}.` });
  const by = String(body.by ?? "").trim();
  if (!by) return send(res, 400, { message: "Say who's deciding." });
  const { changed } = decide(id, action === "approve" ? "approved" : "rejected", by, String(body.note ?? "").trim(), events);
  if (!changed) return send(res, 409, { message: `Already ${approval.status} by ${approval.decided_by}.` });
  work(approval.run, String(body.page ?? ""));
  send(res, 200, { approval });
}

// Works on a run in the background, unless this process is already working on it. When Grok plays
// the customer, that includes writing their replies.
function work(id: string, page?: string): void {
  if (working.has(id)) return;
  const abort = new AbortController();
  working.set(id, { abort, page });
  converse(id, events, abort.signal).finally(() => working.delete(id));
}

// The page gets each run's steps once, as they happen, so status updates leave them out.
function summary({ steps, ...run }: Run): Omit<Run, "steps"> {
  return run;
}

function broadcast(event: string, data: object): void {
  for (const res of pages.values()) emit(res, event, data);
}

function emit(res: ServerResponse, event: string, data: object): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Node never reads a body past its Content-Length, so checking the header caps the body. A request
// without one is turned away too.
async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (!(Number(req.headers["content-length"]) <= MAX_BODY)) return undefined;
  try {
    const body = JSON.parse((await buffer(req)).toString());
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, data: object): void {
  reply(res, status, "application/json", JSON.stringify(data));
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
