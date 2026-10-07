import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { answer, loadCollection } from "./answers.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/collection") return sendCollection(res);
  if (url.pathname === "/api/answer") return streamAnswer(url.searchParams.get("question") ?? "", url.searchParams.get("filter") ?? "", res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// The page lists the documents and builds its filters from their fields. It reads the file again each
// time, so it picks up a collection that npm run ingest made while the server was running.
async function sendCollection(res: ServerResponse): Promise<void> {
  try {
    reply(res, 200, "application/json", JSON.stringify(await loadCollection()));
  } catch (error) {
    reply(res, 404, "application/json", JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

// Answers the question while streaming each step to the page as server-sent events.
async function streamAnswer(question: string, filter: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop searching and answering if the page is closed or the question is stopped.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    if (!question.trim()) throw new Error("Ask a question first.");
    const result = await answer(
      question,
      filter,
      await loadCollection(),
      {
        passages: (passages) => emit("passages", { passages }),
        reasoning: (text) => emit("reasoning", { text }),
        quotes: (quotes) => emit("quotes", { quotes }),
        text: (text) => emit("text", { text }),
      },
      abort.signal,
    );
    emit("done", { found: result.found, text: result.text, quotes: result.quotes, tokens: result.tokens, cost: result.cost });
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error(error);
      emit("failure", { message: error instanceof Error ? error.message : String(error) });
    }
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
