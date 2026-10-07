import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { factCheck } from "./factcheck.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/check") return checkPost(url.searchParams.get("url") ?? "", url.searchParams.get("deep") === "1", res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Fact-checks the post while streaming each step to the page as server-sent events.
async function checkPost(link: string, deep: boolean, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop every search if the page is closed before the note is written.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const result = await factCheck(
      link,
      deep,
      {
        reasoning: (text) => emit("reasoning", { text }),
        tool: (search) => emit("tool", search),
        viewed: (viewed) => emit("viewed", viewed),
        draft: (draft) => emit("draft", draft),
        read: (post, claims) => emit("read", { post, claims }),
        search: (index, search) => emit("search", { index, ...search }),
        failed: (index, error) => console.error(`Couldn't research claim ${index + 1}: ${error.message}`),
        checked: (index, check) => emit("checked", { index, check }),
        writing: (sources) => emit("writing", { sources }),
        note: (sentences) => emit("note", { sentences }),
      },
      abort.signal,
    );
    emit("done", { note: result.note ?? null, spend: result.spend, seconds: result.seconds });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
