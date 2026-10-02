import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import {
  type Comparison,
  type Component,
  type ComponentEvents,
  type Refinement,
  componentPage,
  refineComponent,
  writeComponent,
} from "./component.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-screenshot.png", import.meta.url);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_UPLOAD = 10 * 1024 * 1024;
const screenshots = new Map<string, Blob>();
const refinements = new Map<string, { comparison: Comparison; component: Component }>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-screenshot.png") return reply(res, 200, "image/png", await readFile(SAMPLE));
  if (url.pathname === "/api/screenshots" && req.method === "POST") return saveScreenshot(req, res);
  if (url.pathname === "/api/component") return makeComponent(url.searchParams.get("screenshot") ?? "", res);
  if (url.pathname === "/api/refinements" && req.method === "POST") return saveRefinement(req, res);
  if (url.pathname === "/api/refinement") return refine(url.searchParams.get("id") ?? "", res);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page uploads the screenshot here first,
// then opens the event stream with the id it gets back.
async function saveScreenshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const type = req.headers["content-type"] ?? "";
  if (!IMAGE_TYPES.includes(type)) return reply(res, 415, "text/plain", "Choose a PNG, JPEG, or WebP image.");
  // Node reads exactly content-length bytes of body, so checking the header enforces the limit.
  if (!(Number(req.headers["content-length"]) <= MAX_UPLOAD)) {
    return reply(res, 413, "text/plain", "Choose an image of 10 MB or less.");
  }
  try {
    const id = randomUUID();
    screenshots.set(id, new Blob([await buffer(req)], { type }));
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    // The page went away mid-upload. Left unhandled, the rejection would stop the server.
    res.destroy();
  }
}

// For a later round, the page sends the original screenshot, a screenshot of the component as it
// renders, an overlay of the two, the heights of the component's page and the screenshot, and the
// component itself, as JSON with the images as data URLs.
async function saveRefinement(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(Number(req.headers["content-length"]) <= 4 * MAX_UPLOAD)) {
    return reply(res, 413, "text/plain", "The images can be at most 10 MB each.");
  }
  try {
    const body = JSON.parse((await buffer(req)).toString());
    const [screenshot, render, overlay] = [body.screenshot, body.render, body.overlay].map(fromDataUrl);
    const { name, code, height } = body;
    const measured = Number.isFinite(height?.page) && Number.isFinite(height?.screenshot);
    if (!screenshot || !render || !overlay || !measured || typeof name !== "string" || typeof code !== "string") {
      return reply(res, 400, "text/plain", "Send the screenshot, the render, the overlay, the heights, and the component.");
    }
    const id = randomUUID();
    refinements.set(id, {
      comparison: { screenshot, render, overlay, height: { page: height.page, screenshot: height.screenshot } },
      component: { name, code },
    });
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    if (!res.headersSent) reply(res, 400, "text/plain", "Couldn't read the request.");
  }
}

// Each upload starts one round, so a reconnecting EventSource can't start a second one.
async function makeComponent(id: string, res: ServerResponse): Promise<void> {
  const screenshot = screenshots.get(id);
  if (!screenshot) return reply(res, 404, "text/plain", "Not found");
  screenshots.delete(id);
  await streamRound(res, (on, signal) => writeComponent(screenshot, on, signal));
}

async function refine(id: string, res: ServerResponse): Promise<void> {
  const job = refinements.get(id);
  if (!job) return reply(res, 404, "text/plain", "Not found");
  refinements.delete(id);
  await streamRound(res, (on, signal) => refineComponent(job.comparison, job.component, on, signal));
}

// Runs a round while streaming its progress to the page as server-sent events.
async function streamRound(
  res: ServerResponse,
  run: (on: ComponentEvents, signal: AbortSignal) => Promise<Component | Refinement>,
): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop making API calls if the page is closed before the component is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  let writing = false;
  const startWriting = () => {
    if (writing) return;
    writing = true;
    emit("step", { step: "think", status: "done" });
    emit("step", { step: "write", status: "active" });
  };

  try {
    emit("step", { step: "think", status: "active" });
    const component = await run(
      {
        reasoning: (text) => emit("reasoning", { text }),
        changes: (changes) => {
          startWriting();
          emit("changes", { changes });
        },
        name: (name) => {
          startWriting();
          emit("name", { name });
        },
        code: (text) => {
          startWriting();
          emit("code", { text });
        },
      },
      abort.signal,
    );
    emit("done", { ...component, page: componentPage(component) });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function fromDataUrl(url: unknown): Blob | undefined {
  const match = typeof url === "string" ? url.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/) : null;
  return match ? new Blob([Buffer.from(match[2], "base64")], { type: match[1] }) : undefined;
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
