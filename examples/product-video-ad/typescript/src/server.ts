import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { buffer } from "node:stream/consumers";
import { makeAd } from "./ad.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-product.jpg", import.meta.url);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };
const photos = new Map<string, Blob>();
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-product.jpg") return reply(res, 200, "image/jpeg", await readFile(SAMPLE));
  if (url.pathname === "/api/photos" && req.method === "POST") return savePhoto(req, res);
  if (url.pathname === "/api/ad") return streamAd(url.searchParams.get("photo") ?? "", url.searchParams.get("description") ?? "", res);

  const file = files.get(url.pathname);
  if (file) return sendFile(req, res, file);
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

// Makes the ad while streaming its progress to the page as server-sent events.
async function streamAd(photoId: string, description: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A scene can still finish after another one has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed, or if a step fails while others are still running.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // Only files this run wrote get a URL, so no other file on disk can be requested.
  const id = randomUUID();
  const publish = (path: string) => {
    const url = `/files/${id}/${basename(path)}`;
    files.set(url, path);
    return url;
  };

  // Each photo makes one ad, so a reconnecting EventSource can't start a second run.
  const photo = photos.get(photoId);
  photos.delete(photoId);
  try {
    if (!photo) throw new Error("The photo is gone. Choose it again.");
    const ad = await makeAd(
      photo,
      description,
      {
        step: (step) => emit("step", { step }),
        brief: (brief) => emit("brief", brief),
        scene: (index, path) => emit("scene", { index, url: publish(path) }),
        pick: (pick) => emit("pick", pick),
      },
      abort.signal,
    );
    emit("done", {
      video: publish(`${ad.dir}/${ad.finalCut ? "final.mp4" : "ad.mp4"}`),
      voiceover: ad.finalCut ? undefined : publish(`${ad.dir}/voiceover.mp3`),
      cost: ad.cost,
      dir: ad.dir,
    });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

// Browsers load video in byte ranges, and Safari won't play it without them.
async function sendFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const bytes = await readFile(path);
  const type = TYPES[extname(path)];
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return reply(res, 200, type, bytes);
  const start = Number(range[1]);
  const end = Math.min(Number(range[2] || Infinity), bytes.length - 1);
  if (start > end) return reply(res, 416, "text/plain", "", { "content-range": `bytes */${bytes.length}` });
  reply(res, 206, type, bytes.subarray(start, end + 1), { "content-range": `bytes ${start}-${end}/${bytes.length}` });
}

// Checks the first bytes, because the type a browser sends comes from the file name.
function imageType(bytes: Buffer): string | undefined {
  const head = bytes.toString("latin1", 0, 12);
  if (head.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (head.startsWith("RIFF") && head.slice(8) === "WEBP") return "image/webp";
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...headers }).end(body);
}
