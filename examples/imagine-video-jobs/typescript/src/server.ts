import { readFile } from "node:fs/promises";
import { type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { supabaseSettings } from "./local.ts";

const PORT = Number(process.env.PORT ?? 3102);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-cat.jpg", import.meta.url);
// supabase-js ships a browser bundle, so the page uses the same pinned version as the tests.
const SUPABASE_JS = join(dirname(createRequire(import.meta.url).resolve("@supabase/supabase-js")), "umd/supabase.js");
// Only these two reach the browser. Row-level security decides what they can do.
const { url, publishableKey } = supabaseSettings();

// This server holds no jobs and calls no APIs. The page talks to Supabase directly, so stopping
// the server loses nothing.
createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (pathname === "/config.json") return reply(res, 200, "application/json", JSON.stringify({ url, publishableKey }));
  if (pathname === "/supabase.js") return reply(res, 200, "text/javascript", await readFile(SUPABASE_JS));
  if (pathname === "/sample-cat.jpg") return reply(res, 200, "image/jpeg", await readFile(SAMPLE));
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...headers }).end(body);
}
