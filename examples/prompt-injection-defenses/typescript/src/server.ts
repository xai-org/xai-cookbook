import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { ATTACKS, CONTACTS, USER_EMAIL } from "./attacks.ts";
import { type Defenses, type Status, demoAllowedDomains, runAttack, runSuite } from "./lab.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/run") return runLab(url, res);
  if (url.pathname === "/api/search") return runSearch(res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Runs the suite, or one attack with ?attack=<id>, streaming every step to the page as server-sent events.
async function runLab(url: URL, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed or Stop is clicked.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const defenses: Defenses = {
    fence: flag(url, "fence"),
    gate: flag(url, "gate"),
    validate: flag(url, "validate"),
    confirm: flag(url, "confirm"),
  };
  const only = url.searchParams.get("attack");
  const attacks = only ? ATTACKS.filter((attack) => attack.id === only) : ATTACKS;

  emit("settings", {
    defenses,
    user: USER_EMAIL,
    contacts: CONTACTS,
    attacks: attacks.map(({ id, title, technique, vector, hidesIn }) => ({ id, title, technique, vector, hidesIn })),
  });

  const events = {
    attackStart: (id: string) => emit("attack-start", { id }),
    reasoning: (id: string, text: string) => emit("reasoning", { id, text }),
    toolCall: (id: string, info: object) => emit("tool-call", { id, ...info }),
    toolResult: (id: string, info: object) => emit("tool-result", { id, ...info }),
    confirm: (id: string, info: object) => emit("confirm", { id, ...info }),
    attackDone: (result: object) => emit("attack-done", result),
  };

  try {
    const { results, cost } = only
      ? await single(attacks[0]?.id, defenses, events, abort.signal)
      : await runSuite(defenses, events, abort.signal);
    emit("done", { cost, counts: tally(results.map((result) => result.status)), defenses });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

async function single(id: string | undefined, defenses: Defenses, events: Parameters<typeof runAttack>[2], signal: AbortSignal) {
  const attack = ATTACKS.find((item) => item.id === id);
  if (!attack) return { results: [], cost: 0 };
  const result = await runAttack(attack, defenses, events, signal);
  return { results: [result], cost: result.cost };
}

function tally(statuses: Status[]): Record<Status, number> {
  const counts: Record<Status, number> = { breached: 0, blocked: 0, safe: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

// One search limited to docs.x.ai, the live-web version of the fetch_page allowlist.
async function runSearch(res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    const { text, cost } = await demoAllowedDomains(
      "What reasoning efforts does grok-4.7 support? Answer in one sentence.",
      ["docs.x.ai"],
      {
        reasoning: (text) => emit("reasoning", { text }),
        search: (detail) => emit("search", { detail }),
      },
      abort.signal,
    );
    emit("done", { text, cost, domains: ["docs.x.ai"] });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function flag(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value === "1" || value === "true";
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
