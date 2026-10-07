import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { json } from "node:stream/consumers";
import { LANGUAGES, createSession } from "./interpreter.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/session" && req.method === "POST") return startSession(req, res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Mints a token for one session, so the API key never reaches the browser. Anyone who can call this
// route can open sessions on your account, so a real app would only answer signed-in users.
async function startSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { from, to } = (await json(req).catch(() => ({}))) as { from?: string; to?: string };
  if (!from || !to || !(from in LANGUAGES) || !(to in LANGUAGES) || from === to) {
    return reply(res, 400, "text/plain", "Pick two different languages from the list.");
  }
  try {
    reply(res, 200, "application/json", JSON.stringify(await createSession(from, to)));
  } catch (error) {
    reply(res, 502, "text/plain", error instanceof Error ? error.message : String(error));
  }
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
