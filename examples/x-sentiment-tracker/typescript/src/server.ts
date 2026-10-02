import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { DEFAULT_TOPIC, analyze } from "./sentiment.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/sentiment") return scoreTopic(url.searchParams.get("topic") || DEFAULT_TOPIC, res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Scores the topic while streaming each step to the page as server-sent events.
async function scoreTopic(topic: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop searching and scoring if the page is closed before the score is in.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const sentiment = await analyze(
      topic,
      {
        searching: (query, days) => emit("searching", { query, days }),
        search: (day) => emit("search", { day }),
        searched: (day, posts) => emit("searched", { day, count: posts ? posts.length : null }),
        found: (posts) => emit("found", { count: posts.length }),
        kept: (posts, found) => emit("kept", { posts, filtered: found.length - posts.length }),
        scoring: (posts) => emit("scoring", { count: posts.length }),
        reasoning: (text) => emit("reasoning", { text }),
      },
      abort.signal,
    );
    emit("done", { sentiment: sentiment ?? null });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
