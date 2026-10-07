import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { basename } from "node:path";
import { DEFAULT_MAX_COST, makeBriefing, readTopics } from "./briefing.ts";
import { forget, loadMemory, summarize } from "./memory.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const MAX_TOPICS = 6;
const files = new Map<string, string>();
// Each briefing reads the memory file when it starts and rewrites it when it's done, so only one runs at a time.
let running = false;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/state") return sendState(res);
  if (url.pathname === "/api/memory" && req.method === "DELETE") return clearMemory(res);
  if (url.pathname === "/api/briefing") return streamBriefing(url, res);

  const file = files.get(url.pathname);
  if (file) return sendFile(req, res, file);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

async function sendState(res: ServerResponse): Promise<void> {
  const state = { topics: await readTopics(), maxCost: DEFAULT_MAX_COST, memory: summarize(await loadMemory()) };
  reply(res, 200, "application/json", JSON.stringify(state));
}

async function clearMemory(res: ServerResponse): Promise<void> {
  if (running) return reply(res, 409, "text/plain", "Wait for the briefing to finish.");
  await forget();
  reply(res, 200, "application/json", JSON.stringify(summarize({ briefings: [] })));
}

// Makes the briefing while streaming each step to the page as server-sent events.
async function streamBriefing(url: URL, res: ServerResponse): Promise<void> {
  const topics = url.searchParams.getAll("topic").map((topic) => topic.trim().slice(0, 80)).filter(Boolean).slice(0, MAX_TOPICS);
  const maxCost = Number(url.searchParams.get("cap") ?? DEFAULT_MAX_COST);
  if (!topics.length || !(maxCost > 0 && maxCost <= 5)) return reply(res, 400, "text/plain", "Send one to six topics and a cap of at most $5.");
  if (running) return reply(res, 409, "text/plain", "A briefing is already running.");
  running = true;

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A clip can still finish recording after a failure has ended the response.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop every request if the page is closed, or Stop is clicked, before the briefing is done.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // Only files this run wrote get a URL, so no other file on disk can be requested.
  const id = randomUUID();
  const publish = (path: string) => {
    const fileUrl = `/files/${id}/${basename(path)}`;
    files.set(fileUrl, path);
    return fileUrl;
  };

  try {
    const briefing = await makeBriefing(
      topics,
      maxCost,
      {
        start: (plan) => emit("start", { ...plan, maxCost }),
        topic: (index, remembered) => emit("topic", { index, remembered }),
        search: (index, search) => emit("search", { index, ...search }),
        reasoning: (index, text) => emit("reasoning", { index, text }),
        writing: (index) => emit("writing", { index }),
        report: (index, report, spent) => emit("report", { index, ...report, spent }),
        skipped: (index, reason) => emit("skipped", { index, reason }),
        clip: (index, clip, text) => emit("clip", { index, url: publish(clip.path), seconds: clip.seconds, text }),
      },
      abort.signal,
    );
    emit("done", { cost: briefing.cost, seconds: briefing.seconds, url: publish(briefing.file), dir: briefing.dir, memory: summarize(await loadMemory()) });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
  res.end();
}

// Browsers load audio in byte ranges to seek, and Safari won't play it without them.
async function sendFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const bytes = await readFile(path);
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return reply(res, 200, "audio/mpeg", bytes, { "accept-ranges": "bytes" });
  const start = Number(range[1]);
  const end = Math.min(Number(range[2] || Infinity), bytes.length - 1);
  if (start > end) return reply(res, 416, "text/plain", "", { "content-range": `bytes */${bytes.length}` });
  reply(res, 206, "audio/mpeg", bytes.subarray(start, end + 1), { "content-range": `bytes ${start}-${end}/${bytes.length}` });
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...headers }).end(body);
}
