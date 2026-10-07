import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { type Usage, ask } from "./agent.ts";
import { QUESTIONS } from "./questions.ts";
import { SERVICES, TOOLS } from "./tools.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/catalog") {
    const operations = TOOLS.map(({ name, service, summary }) => ({ name, service, summary }));
    return reply(res, 200, "application/json", JSON.stringify({ services: SERVICES, operations, questions: QUESTIONS }));
  }
  if (url.pathname === "/api/ask") return answer(url.searchParams.get("question") || QUESTIONS[0], res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Asks the question two ways at once, with every tool sent and with only the tools Grok asks for, and
// streams each run's steps, token counts, and answer to the page as server-sent events, tagged with
// the run they belong to.
async function answer(question: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop both runs if the page is closed.
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);

  // A run that fails reports it and leaves the other one running, so the page still shows both.
  const run = (mode: "upfront" | "deferred") =>
    ask(
      question,
      TOOLS,
      mode === "deferred",
      {
        search: (query) => emit("search", { mode, query }),
        loaded: (names) => emit("loaded", { mode, names }),
        call: (id, name, args) => emit("call", { mode, id, name, args }),
        result: (id, status, body) => emit("result", { mode, id, status, body }),
        text: (text) => emit("text", { mode, text }),
        usage: (usage: Usage) => emit("usage", { mode, ...usage, seconds: seconds() }),
      },
      abort.signal,
    ).then(
      () => emit("answer", { mode, seconds: seconds() }),
      (error) => {
        if (!abort.signal.aborted) emit("failure", { mode, message: error instanceof Error ? error.message : String(error) });
      },
    );

  await Promise.all([run("upfront"), run("deferred")]);
  emit("done", { seconds: seconds() });
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
