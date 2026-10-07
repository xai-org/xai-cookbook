import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { basename } from "node:path";
import { type Brief, DEFAULT_COMPANY, MAX_TURNS, prepareBrief } from "./brief.ts";
import { ACCOUNTS } from "./crm.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const DRAFT_MS = 100;
// Only briefs a run saved get a URL, so no other file on disk can be requested.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/accounts") return reply(res, 200, "application/json", JSON.stringify(ACCOUNTS));
  if (url.pathname === "/api/brief") return streamBrief(url.searchParams.get("company")?.trim() || DEFAULT_COMPANY, res);

  const file = files.get(url.pathname);
  if (file) {
    return reply(res, 200, "text/markdown; charset=utf-8", await readFile(file), {
      "content-disposition": `attachment; filename="${basename(file)}"`,
    });
  }
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Prepares the brief while streaming each step to the page as server-sent events.
async function streamBrief(company: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop the run if the page is closed before the brief is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  // The brief so far arrives every few characters Grok writes, so the page gets it at most every DRAFT_MS.
  let draft: Partial<Brief> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const sendDraft = () => {
    clearTimeout(timer);
    timer = undefined;
    if (draft) emit("draft", { brief: draft });
    draft = undefined;
  };

  try {
    emit("start", { company, maxTurns: MAX_TURNS });
    const { brief, dropped, totals, file } = await prepareBrief(
      company,
      {
        request: (index) => emit("request", { index }),
        reasoning: (text) => emit("reasoning", { text }),
        search: (search) => emit("search", search),
        lookup: (lookup) => emit("lookup", lookup),
        usage: (totals) => emit("usage", { totals }),
        draft: (partial) => {
          draft = partial;
          timer ??= setTimeout(sendDraft, DRAFT_MS);
        },
      },
      abort.signal,
    );
    sendDraft();
    const download = `/files/${randomUUID()}/${basename(file)}`;
    files.set(download, file);
    emit("done", { brief, dropped, totals, download });
  } catch (error) {
    clearTimeout(timer);
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, ...headers }).end(body);
}
