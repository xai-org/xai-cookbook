import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { pipeline } from "node:stream";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { DEFAULT_LANGUAGE, dubVideo, languageName, slugify } from "./dub.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = fileURLToPath(new URL("../sample-clip.mp4", import.meta.url));
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const TYPES: Record<string, string> = { ".mp4": "video/mp4" };
// Uploaded videos waiting to be dubbed, by id.
const uploads = new Map<string, string>();
// The URL and path of every file a run has saved. The server serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-clip.mp4") return sendFile(req, res, SAMPLE);
  if (url.pathname === "/api/videos" && req.method === "POST") return saveVideo(req, res, url.searchParams.get("name") ?? "video");
  if (url.pathname === "/api/dub") {
    return dub(url.searchParams.get("video") ?? "", url.searchParams.get("language") || DEFAULT_LANGUAGE, res);
  }
  const path = files.get(url.pathname);
  if (path) return sendFile(req, res, path);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, so the page uploads the video here first and then opens the
// event stream with the id it gets back.
async function saveVideo(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  // A request without one is turned away too.
  if (!(Number(req.headers["content-length"]) <= MAX_VIDEO_BYTES)) {
    return reply(res, 413, "text/plain", "The video can be at most 200 MB.");
  }
  try {
    const bytes = await buffer(req);
    // MP4 and QuickTime files both start with an ftyp box, four bytes in.
    if (bytes.toString("latin1", 4, 8) !== "ftyp") return reply(res, 415, "text/plain", "The video has to be an MP4 or a MOV.");
    await mkdir("output/uploads", { recursive: true });
    const path = `output/uploads/${slugify(name.replace(/\.\w+$/, ""))}${extname(name).toLowerCase() === ".mov" ? ".mov" : ".mp4"}`;
    await writeFile(path, bytes);
    const id = randomUUID();
    uploads.set(id, path);
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    // The page went away mid-upload. Left unhandled, the rejection would stop the server.
    res.destroy();
  }
}

// Dubs the video while streaming its progress to the page as server-sent events.
async function dub(videoId: string, language: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A line that was recording when another one failed can finish after the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed or Stop is clicked before the dub is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  // Each upload makes one dub, so a reconnecting EventSource can't start a second run.
  const video = videoId === "sample" ? SAMPLE : uploads.get(videoId);
  uploads.delete(videoId);
  const id = randomUUID();
  const publish = (path: string) => {
    const url = `/files/${id}/${basename(path)}`;
    files.set(url, path);
    return url;
  };
  const started = Date.now();

  try {
    if (!video) throw new Error("The video is gone. Choose it again.");
    const result = await dubVideo(
      video,
      language,
      {
        step: (step, status) => emit("step", { step, status }),
        transcript: (transcript) => {
          emit("transcript", { ...transcript, name: languageName(transcript.language), target: languageName(language) });
        },
        reasoning: (text) => emit("reasoning", { text }),
        translation: (line, text, done) => emit("translation", { id: line.id, text, done }),
        take: (line, { text, speed, start, length, words }, next) => {
          emit("take", { id: line.id, text, speed, start, length, words, next });
        },
      },
      abort.signal,
    );
    emit("done", {
      video: publish(result.video),
      folder: result.dir,
      seconds: (Date.now() - started) / 1000,
      cost: result.cost,
    });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
    // Stop the other lines too, rather than pay for a dub that won't be finished.
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
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    ...(range && { "content-range": `bytes ${start}-${end}/${size}` }),
  });
  // Browsers drop a video request partway through when they seek, so a response that closes early isn't an error.
  pipeline(createReadStream(path, { start, end }), res, () => {});
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
