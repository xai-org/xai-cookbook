import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { basename } from "node:path";
import { COMPACT_AFTER, MODEL } from "./chat.ts";
import { CHATS, SCRIPT, compare, saveResults } from "./compare.ts";

type Emit = (event: string, data: object) => void;

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/compare") return run(res);

  const file = files.get(url.pathname);
  if (file) return reply(res, 200, "application/json", await readFile(file));
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Plays the scripted chat three ways at once and streams every turn to the page.
function run(res: ServerResponse): Promise<void> {
  return streamEvents(res, async (emit, signal) => {
    emit("start", { script: SCRIPT, chats: CHATS, compact_after: COMPACT_AFTER, model: MODEL });
    const results = await compare(
      SCRIPT,
      {
        ask: (chat, index) => emit("ask", { chat, index }),
        text: (chat, index, text) => emit("text", { chat, index, text }),
        answer: (chat, index, turn) => emit("answer", { chat, index, turn }),
        compacting: (chat, index) => emit("compacting", { chat, index }),
        compacted: (chat, index, compaction) => emit("compacted", { chat, index, compaction }),
        failed: (chat, error) => {
          console.error(`The ${CHATS[chat].name} chat stopped: ${error.message}`);
          emit("failed", { chat, message: error.message });
        },
      },
      signal,
    );
    const path = await saveResults(results);
    // Only files a run wrote get a URL, so no other file on disk can be requested.
    const url = `/files/${randomUUID()}/${basename(path)}`;
    files.set(url, path);
    emit("done", { results: url, path });
  });
}

// Runs `work` while streaming its events to the page as server-sent events, and stops it if the page
// is closed before it's done.
async function streamEvents(res: ServerResponse, work: (emit: Emit, signal: AbortSignal) => Promise<void>): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // When the run is stopped, the other chats can still report something before their requests end.
  const emit: Emit = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    await work(emit, abort.signal);
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
