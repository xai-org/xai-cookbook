import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join } from "node:path";
import { buffer } from "node:stream/consumers";
import { type Message, ask, attach } from "./chat.ts";
import { MAX_BYTES, OUTPUT_DIR, PORT, SAMPLE_QUESTIONS, SEED_USERS, SIGNED_PATH, TTL, TYPES, errorMessage, fileMode, isLocal, supabaseEnv } from "./config.ts";
import { AuthError, deleteFile, downloadFile, listFiles, listReads, recordRead, safeName, signFileUrl, signIn, uploadFile, userClient, userIdFrom, anon } from "./storage.ts";

const PAGE = new URL("../public/index.html", import.meta.url);
const COOKIE = "session";
const env = supabaseEnv();
const local = isLocal(env.url);
// A signed URL on a hosted project. On a local stack, which SpaceXSI can't reach, a copy in the Files API.
const mode = fileMode(env.url);

const asks = new Map<string, { token: string; userId: string; name: string; question: string; ttl: number; history: Message[]; at: number }>();
const MAX_UPLOAD = MAX_BYTES;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/" && req.method === "GET") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
    if (url.pathname === "/api/status") {
      return json(res, 200, {
        mode,
        local,
        hasKey: Boolean(process.env.XAI_API_KEY),
        ttl: TTL,
        samples: SAMPLE_QUESTIONS,
      });
    }
    if (url.pathname === "/api/demo-users") return json(res, 200, SEED_USERS.map(({ name, email, password, sample }) => ({ name, email, password, sample })));
    if (url.pathname === "/api/login" && req.method === "POST") return login(req, res);
    if (url.pathname === "/api/logout" && req.method === "POST") {
      res.setHeader("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, 200, {});
    }

    const session = await currentUser(req);
    if (!session) return json(res, 401, { message: "Sign in first." });
    const { token, userId, db } = session;

    if (url.pathname === "/api/me") return json(res, 200, { id: userId, email: session.email });
    if (url.pathname === "/api/files" && req.method === "GET") return json(res, 200, await listFiles(db, userId));
    if (url.pathname === "/api/files" && req.method === "POST") {
      const ext = extname(url.searchParams.get("name") ?? "").toLowerCase();
      if (!TYPES[ext]) return json(res, 415, { message: `Use one of ${Object.keys(TYPES).join(", ")}.` });
      // Node never reads a body past its Content-Length, so checking the header caps the upload.
      if (!(Number(req.headers["content-length"]) <= MAX_UPLOAD)) return json(res, 413, { message: "A file can be at most 50 MB." });
      const name = safeName(url.searchParams.get("name") ?? "file");
      const body = await buffer(req);
      await uploadFile(db, userId, name, new Blob([new Uint8Array(body)], { type: TYPES[ext] }));
      return json(res, 200, { name });
    }
    if (url.pathname === "/api/files" && req.method === "DELETE") {
      await deleteFile(db, `${userId}/${safeName(url.searchParams.get("name") ?? "")}`);
      return json(res, 200, {});
    }
    if (url.pathname === "/api/reads") return json(res, 200, await listReads(db));
    if (url.pathname === "/api/ask" && req.method === "POST") return startAsk(req, res, token, userId);
    if (url.pathname === "/api/ask/stream") return streamAsk(url.searchParams.get("id") ?? "", userId, res);
    if (url.pathname === "/api/probe" && req.method === "POST") return probe(req, res);
    if (url.pathname === "/api/try-other" && req.method === "POST") return tryOther(res, userId, db);
    json(res, 404, { message: "Not found" });
  } catch (error) {
    if (!res.headersSent) json(res, error instanceof AuthError ? 401 : 500, { message: errorMessage(error) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Open http://localhost:${PORT}`);
  if (mode === "signed_url") console.log(`Signed URL mode: Grok fetches each file straight from ${env.url}`);
  else if (local) console.log("Upload mode: SpaceXSI can't reach a local stack, so each file is copied to the Files API for one answer, then deleted.");
  else console.log("Upload mode: each file is copied to the Files API for one answer, then deleted.");
});

async function currentUser(req: IncomingMessage) {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  if (!token) return undefined;
  try {
    const userId = await userIdFrom(token);
    const claims = await anon().auth.getClaims(token);
    return { token, userId, db: userClient(token), email: String(claims.data?.claims.email ?? "") };
  } catch {
    return undefined;
  }
}

// The session is the user's access token in a cookie the page's scripts can't read. The server holds no key
// of its own that skips policies: every request uses a client built from this token.
async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { email, password } = JSON.parse((await buffer(req)).toString()) as { email?: string; password?: string };
  try {
    const session = await signIn(String(email ?? ""), String(password ?? ""));
    res.setHeader("set-cookie", `${COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    json(res, 200, { id: session.userId, email: session.email });
  } catch (error) {
    json(res, 401, { message: errorMessage(error) });
  }
}

// EventSource can only make GET requests, so the page posts the question here first and then opens the event
// stream with the id it gets back. An id works once, so a reconnecting EventSource can't ask, and bill, twice.
async function startAsk(req: IncomingMessage, res: ServerResponse, token: string, userId: string): Promise<void> {
  const body = JSON.parse((await buffer(req)).toString()) as { name?: string; question?: string; ttl?: number; history?: Message[] };
  const question = String(body.question ?? "").trim().slice(0, 2000);
  if (!question || !body.name) return json(res, 400, { message: "Pick a file and type a question." });
  const ttl = Math.min(TTL.max, Math.max(TTL.min, Math.round(Number(body.ttl) || TTL.default)));
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.text === "string")
    .slice(-6)
    .map((message) => ({ role: message.role, text: message.text.slice(0, 4000) }));
  for (const [id, pending] of asks) if (Date.now() - pending.at > 30_000) asks.delete(id);
  const id = randomUUID();
  asks.set(id, { token, userId, name: safeName(String(body.name)), question, ttl, history, at: Date.now() });
  json(res, 200, { id });
}

async function streamAsk(id: string, userId: string, res: ServerResponse): Promise<void> {
  const pending = asks.get(id);
  if (!pending || pending.userId !== userId) return json(res, 404, { message: "Not found" });
  asks.delete(id);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Cancels the request, and stops waiting for Grok's reads, if the page is closed or Stop is clicked.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const object = `${userId}/${pending.name}`;
  const started = Date.now();
  let cleanup = async () => {};
  const db = userClient(pending.token);
  try {
    const attachment = await attach(db, object, mode, { ttl: pending.ttl, signal: abort.signal });
    cleanup = attachment.cleanup;
    // The read is recorded as the user, so the table's policies decide whose it is.
    await recordRead(db, { object_name: object, mode, url_expires_at: attachment.expiresAt ?? null, question: pending.question });
    emit("attached", { mode, object, url: attachment.url, claims: attachment.claims, expiresAt: attachment.expiresAt, fileId: attachment.fileId });

    const answer = await ask({
      question: pending.question,
      history: pending.history,
      attachment,
      on: {
        searching: (search) => emit("searching", search),
        searched: (search) => emit("searched", search),
        text: (text) => emit("text", { text }),
      },
      signal: abort.signal,
    });
    emit("done", {
      cost: answer.cost,
      documentSearches: answer.documentSearches,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      seconds: (Date.now() - started) / 1000,
    });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: errorMessage(error) });
  } finally {
    await cleanup();
    if (mode === "upload") emit("cleanup", {});
  }
  res.end();
}

// Fetches a URL from the server, so the page can show what Grok would get now without running into CORS.
// It only fetches this app's own signed Storage URLs, so it can't be pointed at anything else. Only signed URL
// mode hands out URLs, so on a local stack there's nothing to check.
async function probe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { url } = JSON.parse((await buffer(req)).toString()) as { url?: string };
  let target: URL;
  try {
    target = new URL(String(url));
  } catch {
    return json(res, 400, { message: "Not a URL" });
  }
  if (mode !== "signed_url" || target.origin !== new URL(env.url).origin || !SIGNED_PATH.test(target.pathname)) {
    return json(res, 400, { message: "Only this app's signed file URLs can be checked." });
  }
  const at = Date.now();
  try {
    const response = await fetch(target, { redirect: "manual" });
    const body = Buffer.from(await response.arrayBuffer());
    const bytes = body.byteLength;
    const text = response.ok ? "" : body.toString().slice(0, 300);
    let error: string | undefined;
    if (!response.ok) {
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        error = [parsed.error, parsed.message].filter(Boolean).join(": ");
      } catch {
        error = text;
      }
    }
    json(res, 200, { status: response.status, contentType: response.headers.get("content-type"), bytes, error, at });
  } catch (error) {
    json(res, 200, { status: 0, contentType: null, bytes: 0, error: errorMessage(error), at });
  }
}

// Runs four attempts at the other demo user's file as the current user. Each should fail.
async function tryOther(res: ServerResponse, userId: string, db: ReturnType<typeof userClient>): Promise<void> {
  let users: Record<string, { id: string; path: string; email: string }>;
  try {
    users = JSON.parse(await readFile(join(OUTPUT_DIR, "users.json"), "utf8"));
  } catch {
    return json(res, 400, { message: "Run npm run seed first." });
  }
  const other = Object.values(users).find((user) => user.id !== userId);
  if (!other) return json(res, 400, { message: "Run npm run seed first." });
  const steps: Array<{ step: string; blocked: boolean; detail: string }> = [];

  const listing = await db.storage.from("files").list(other.id);
  const seen = listing.data?.filter((file) => file.name !== ".emptyFolderPlaceholder").length ?? 0;
  steps.push({ step: `List ${other.email}'s folder`, blocked: seen === 0, detail: listing.error ? listing.error.message : `${seen} files visible` });

  const signed = await signFileUrl(db, other.path, 60).then(
    () => undefined,
    (error: unknown) => errorMessage(error),
  );
  steps.push({ step: "Sign a URL for their file", blocked: Boolean(signed), detail: signed ?? "Signed a URL" });

  const download = await downloadFile(db, other.path).then(
    () => undefined,
    (error: unknown) => errorMessage(error),
  );
  steps.push({ step: "Download their file", blocked: Boolean(download), detail: download ?? "Downloaded it" });

  const upload = await uploadFile(db, other.id, "planted.txt", new Blob(["hello"], { type: "text/plain" })).then(
    () => undefined,
    (error: unknown) => errorMessage(error),
  );
  steps.push({ step: "Upload into their folder", blocked: Boolean(upload), detail: upload ?? "Uploaded a file" });
  json(res, 200, steps);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  reply(res, status, "application/json", JSON.stringify(body));
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body);
}
