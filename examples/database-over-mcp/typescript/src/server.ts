import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { ALLOWED_TOOLS, SAMPLE_QUESTION, ask, openStore } from "./ask.ts";
import { MAX_ROWS, QUERY_TIMEOUT_MS, TOOLS } from "./mcp-server.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PORT = Number(process.env.MCP_PORT ?? 3001);
const PAGE = new URL("../public/index.html", import.meta.url);

// The MCP server gets its own port, so the tunnel exposes it and not this page, which spends API credits.
console.log("Starting the MCP server and opening a tunnel to it");
const store = await openStore(MCP_PORT);
const connection = JSON.stringify({
  url: store.url,
  port: MCP_PORT,
  tools: TOOLS.map(({ name, description }) => ({ name, description, allowed: ALLOWED_TOOLS.includes(name) })),
  maxRows: MAX_ROWS,
  timeoutSeconds: QUERY_TIMEOUT_MS / 1000,
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/connection") return reply(res, 200, "application/json", connection);
  if (url.pathname === "/api/ask") return answer(url.searchParams.get("question") || SAMPLE_QUESTION, res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`MCP server at ${store.url}\nOpen http://localhost:${PORT}`));

// Asks Grok the question while streaming each step to the page as server-sent events.
async function answer(question: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A query can still finish on the MCP server after the page has closed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop Grok if the page is closed before the answer is in.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const started = Date.now();
  try {
    const result = await ask(
      question,
      store,
      {
        reasoning: (text) => emit("reasoning", { text }),
        calling: (id, tool) => emit("calling", { id, tool }),
        called: (step) => emit("called", step),
        text: (text) => emit("text", { text }),
        request: (request) => emit("request", request),
      },
      abort.signal,
    );
    emit("done", { cost: result.cost, calls: result.steps.length, seconds: (Date.now() - started) / 1000 });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
