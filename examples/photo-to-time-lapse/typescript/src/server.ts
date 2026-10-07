import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { pipeline } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describeChange, makeTimeLapse } from "./timelapse.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-street.jpg", import.meta.url);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_CHANGE_LENGTH = 300;
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".mp4": "video/mp4" };
const photos = new Map<string, Blob>();
// The URL and path of every file a run has saved. The server serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-street.jpg") return reply(res, 200, "image/jpeg", await readFile(SAMPLE));
  if (url.pathname === "/api/photos" && req.method === "POST") return savePhoto(req, res);
  if (url.pathname === "/api/time-lapse") {
    return streamTimeLapse(url.searchParams.get("photo") ?? "", url.searchParams.get("change") ?? "", res);
  }

  const path = files.get(url.pathname);
  if (path) return sendFile(req, res, path);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page uploads the photo here first and then
// opens the event stream with the id it gets back.
async function savePhoto(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  // A request without one is turned away too.
  if (!(Number(req.headers["content-length"]) <= MAX_PHOTO_BYTES)) {
    return reply(res, 413, "text/plain", "The photo can be at most 10 MB.");
  }
  const bytes = await buffer(req);
  const type = imageType(bytes);
  if (!type) return reply(res, 415, "text/plain", "The photo has to be a JPEG, PNG, or WebP.");
  const id = randomUUID();
  photos.set(id, new Blob([bytes], { type }));
  reply(res, 200, "application/json", JSON.stringify({ id }));
}

// Makes the time-lapse while streaming its progress to the page as server-sent events.
async function streamTimeLapse(photoId: string, change: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A still can finish after another one has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed or the run is stopped.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const id = randomUUID();
  const publish = (path: string) => {
    const url = `/files/${id}/${basename(path)}`;
    files.set(url, path);
    return url;
  };

  // Each photo makes one time-lapse, so a reconnecting EventSource can't start a second run.
  const photo = photos.get(photoId);
  photos.delete(photoId);
  try {
    if (!photo) throw new Error("The photo is gone. Choose it again.");
    const request = describeChange(change.trim().slice(0, MAX_CHANGE_LENGTH));
    if (!request) throw new Error("Pick a change or describe one.");
    const lapse = await makeTimeLapse(
      photo,
      request,
      {
        step: (step) => emit("step", { step }),
        reasoning: (text) => emit("reasoning", { text }),
        stage: (stage, index) => emit("stage", { index, ...stage }),
        plan: (plan) => emit("plan", plan),
        still: (index, path) => emit("still", { index, url: publish(path) }),
        progress: (percent) => emit("progress", { percent }),
      },
      abort.signal,
    );
    emit("done", { video: publish(`${lapse.dir}/time-lapse.mp4`), cost: lapse.cost, dir: lapse.dir });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
    // Stop the other edits too, rather than pay for stills that won't be used.
    abort.abort();
  }
  res.end();
}

// Browsers load video in byte ranges, which lets them seek. Any other request gets the whole file.
async function sendFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const { size } = await stat(path);
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) {
    res.writeHead(416, { "content-range": `bytes */${size}` }).end();
    return;
  }
  res.writeHead(range ? 206 : 200, {
    "content-type": TYPES[extname(path)],
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    ...(range && { "content-range": `bytes ${start}-${end}/${size}` }),
  });
  // Browsers drop a video request partway through when they seek, so a response that closes early isn't an error.
  pipeline(createReadStream(path, { start, end }), res, () => {});
}

// Checks the first bytes, because the type a browser sends comes from the file name.
function imageType(bytes: Buffer): string | undefined {
  const head = bytes.toString("latin1", 0, 12);
  if (head.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (head.startsWith("RIFF") && head.slice(8) === "WEBP") return "image/webp";
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
