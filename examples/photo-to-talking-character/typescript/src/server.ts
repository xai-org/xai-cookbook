import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { pipeline } from "node:stream";
import { buffer } from "node:stream/consumers";
import { listVoices, makeScene, previewVoice, sceneLength, writePrompt } from "./scene.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLES = ["/sample-dog.jpg", "/sample-cat.jpg"];
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_LINE = 200;
const pictures = new Map<string, Blob>();
const previews = new Map<string, Uint8Array>();
// The URL and path of every video a run has saved. The server serves these files and nothing else.
const videos = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (SAMPLES.includes(url.pathname)) return reply(res, 200, "image/jpeg", await readFile(new URL(`..${url.pathname}`, import.meta.url)));
  if (url.pathname === "/api/voices") return sendVoices(res);
  if (url.pathname === "/api/prompt") return sendPrompt(url.searchParams.getAll("line"), res);
  if (url.pathname === "/api/preview") return sendPreview(url.searchParams.get("voice") ?? "", url.searchParams.get("text") ?? "", res);
  if (url.pathname === "/api/pictures" && req.method === "POST") return savePicture(req, res);
  if (url.pathname === "/api/scene") return streamScene(url.searchParams, res);

  const path = videos.get(url.pathname);
  if (path) return sendFile(req, res, path);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

async function sendVoices(res: ServerResponse): Promise<void> {
  const signal = closed(res);
  try {
    reply(res, 200, "application/json", JSON.stringify(await listVoices(signal)));
  } catch (error) {
    if (!signal.aborted) reply(res, 502, "text/plain", error instanceof Error ? error.message : String(error));
  }
}

// The page shows the prompt it's about to send while the lines are being written.
function sendPrompt(lines: string[], res: ServerResponse): void {
  if (lines.length < 1 || lines.length > 3) return reply(res, 400, "text/plain", "Send one to three lines.");
  reply(res, 200, "application/json", JSON.stringify({ prompt: writePrompt(lines), seconds: sceneLength(lines) }));
}

// Previews are kept, so playing one again doesn't pay for it again.
async function sendPreview(voice: string, text: string, res: ServerResponse): Promise<void> {
  if (!voice || !text.trim() || text.length > MAX_LINE) return reply(res, 400, "text/plain", "Send a voice and a line to say.");
  const signal = closed(res);
  const key = `${voice}\n${text}`;
  try {
    const audio = previews.get(key) ?? (await previewVoice(voice, text, signal));
    previews.set(key, audio);
    reply(res, 200, "audio/mpeg", audio);
  } catch (error) {
    if (!signal.aborted) reply(res, 502, "text/plain", error instanceof Error ? error.message : String(error));
  }
}

// EventSource can only make GET requests, so the page uploads each picture here first and then
// opens the event stream with the ids it gets back.
async function savePicture(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  // A request without one is turned away too.
  if (!(Number(req.headers["content-length"]) <= MAX_PICTURE_BYTES)) {
    return reply(res, 413, "text/plain", "A picture can be at most 10 MB.");
  }
  try {
    const bytes = await buffer(req);
    const type = imageType(bytes);
    if (!type) return reply(res, 415, "text/plain", "A picture has to be a JPEG, PNG, or WebP.");
    const id = randomUUID();
    pictures.set(id, new Blob([bytes], { type }));
    reply(res, 200, "application/json", JSON.stringify({ id }));
  } catch {
    // The page went away mid-upload. Left unhandled, the rejection would stop the server.
    res.destroy();
  }
}

// Makes the video while streaming its progress to the page as server-sent events.
async function streamScene(params: URLSearchParams, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop waiting for the video if the page is closed or the Stop button is clicked. A video that has
  // started keeps rendering and is billed anyway, because the API can't cancel one.
  const signal = closed(res);

  // Each upload makes one video, so a reconnecting EventSource can't start a second run.
  const images = params.getAll("picture").map((id) => {
    const image = pictures.get(id);
    pictures.delete(id);
    return image;
  });
  const voices = params.getAll("voice");
  const lines = params.getAll("line").map((line) => line.trim());
  try {
    if (images.length < 1 || images.length > 3) throw new Error("A scene has one to three characters.");
    const cast = images.map((image, index) => {
      if (!image) throw new Error("A picture is gone. Choose it again.");
      if (!voices[index] || !lines[index] || lines[index].length > MAX_LINE) {
        throw new Error(`Give each character a voice and a line of at most ${MAX_LINE} characters.`);
      }
      return { image, voice: voices[index], line: lines[index] };
    });
    const scene = await makeScene(
      cast,
      {
        started: (prompt, seconds) => emit("started", { prompt, seconds }),
        progress: (percent) => emit("progress", { percent }),
      },
      signal,
    );
    const url = `/files/${randomUUID()}/scene.mp4`;
    videos.set(url, `${scene.dir}/scene.mp4`);
    emit("done", { video: url, cost: scene.cost, dir: scene.dir });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

// Aborts when the response closes, so the API calls for a request stop when the page goes away.
function closed(res: ServerResponse): AbortSignal {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  return abort.signal;
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
    "content-type": "video/mp4",
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
