import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_TOOLS, LOCAL_STACK, ask } from "./ask.ts";
import { DEMO_USERS, type User, type Who, accessToken, callMemoryTool, functionUrl, listMemories, signIn, supabaseSettings, warmUp } from "./supabase.ts";

const PORT = Number(process.env.PORT ?? 3101);
const PAGE = new URL("../public/index.html", import.meta.url);
const NO_KEY = "Asking Grok needs XAI_API_KEY. Put it in .env at the root of the repo and restart.";

if (!process.env.XAI_API_KEY) console.warn(`${NO_KEY}\nSigning in and the memories panel work without it.`);

const settings = supabaseSettings();
const target = functionUrl(settings.url);
// Grok reaches only the deployed function. Against the local stack, signing in and the memories panel still work.
if (settings.local) console.warn(`${LOCAL_STACK}\nSigning in and the memories panel work on the local stack.`);

// The tools the function really serves, asked the way SpaceXSI asks, for the page's panel.
const warm = await signIn(settings, "alice");
const warmToken = await accessToken(warm.client);
const listed = await callMemoryTool(warmToken, target, "tools/list");
const tools: Array<{ name: string; description: string }> = listed.body?.result?.tools ?? [];
await warmUp(settings, warmToken);
const connection = JSON.stringify({
  url: target,
  hosted: !settings.local,
  tools: tools.map(({ name, description }) => ({ name, description, allowed: ALLOWED_TOOLS.includes(name) })),
});

// One signed-in person per browser, kept here behind an HttpOnly cookie. The page never sees the token.
type Visit = { client: SupabaseClient; user: User; previousResponseId?: string; conversation: number };
const visits = new Map<string, Visit>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const sid = /(?:^|; )sid=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
  const visit = sid ? visits.get(sid) : undefined;
  try {
    if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
    if (url.pathname === "/api/connection") return reply(res, 200, "application/json", connection);
    if (url.pathname === "/api/session") return json(res, 200, { user: visit?.user ?? null, conversation: visit?.conversation ?? 1 });
    if (url.pathname === "/api/sign-in" && req.method === "POST") return await signInRoute(req, res);
    if (!visit) return json(res, 401, { error: "Sign in first" });
    if (url.pathname === "/api/new" && req.method === "POST") {
      visit.previousResponseId = undefined;
      visit.conversation++;
      return json(res, 200, { conversation: visit.conversation });
    }
    if (url.pathname === "/api/memories") return json(res, 200, { memories: await listMemories(visit.client) });
    if (url.pathname === "/api/ask") return await answer(url.searchParams.get("message") ?? "", visit, res);
    reply(res, 404, "text/plain", "Not found");
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Memory server at ${target}\nOpen http://localhost:${PORT}`));

async function signInRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = "";
  for await (const chunk of req) body += chunk;
  const who = JSON.parse(body || "{}").who as Who;
  if (!Object.hasOwn(DEMO_USERS, who)) return json(res, 400, { error: "Pick Alice or Bob" });
  const { client, user } = await signIn(settings, who);
  const sid = randomBytes(24).toString("base64url");
  visits.set(sid, { client, user, conversation: 1 });
  res.setHeader("set-cookie", `sid=${sid}; HttpOnly; SameSite=Strict; Path=/`);
  json(res, 200, { user, memories: await listMemories(client), conversation: 1 });
}

// Asks Grok while streaming each step to the page as server-sent events.
async function answer(message: string, visit: Visit, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  if (!process.env.XAI_API_KEY || settings.local) {
    emit("failure", { message: settings.local ? LOCAL_STACK : NO_KEY });
    return void res.end();
  }

  // Stop Grok if the page is closed before the answer is in.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const started = Date.now();
  try {
    const token = await accessToken(visit.client);
    const reply = await ask(
      message,
      { serverUrl: target, accessToken: token, userId: visit.user.id, previousResponseId: visit.previousResponseId },
      {
        reasoning: (text) => emit("reasoning", { text }),
        calling: (id, tool) => emit("calling", { id, tool }),
        called: (step) => emit("called", step),
        text: (text) => emit("text", { text }),
      },
      abort.signal,
    );
    visit.previousResponseId = reply.responseId;
    emit("done", { cost: reply.cost, calls: reply.steps.length, seconds: (Date.now() - started) / 1000, conversation: visit.conversation });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function json(res: ServerResponse, status: number, body: object): void {
  reply(res, status, "application/json", JSON.stringify(body));
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
