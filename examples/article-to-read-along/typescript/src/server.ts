import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { text } from "node:stream/consumers";
import { COST_PER_CHARACTER, VOICE, fromText, readArticle, recordAll } from "./readalong.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const SAMPLE = new URL("../sample-article.txt", import.meta.url);
const MAX_INPUT_BYTES = 1024 * 1024;
// What each page asked to read, by id, until its run starts.
const inputs = new Map<string, string>();
// Every clip the server has recorded, by URL. It serves these and nothing else.
const clips = new Map<string, Uint8Array>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/sample-article.txt") return reply(res, 200, "text/plain; charset=utf-8", await readFile(SAMPLE));
  if (url.pathname === "/api/articles" && req.method === "POST") return saveInput(req, res);
  if (url.pathname === "/api/read") return readAloud(url.searchParams.get("article") ?? "", res);

  const clip = clips.get(url.pathname);
  if (clip) return sendAudio(req, res, clip);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// EventSource can only make GET requests, and pasted text can be too long for a URL, so the page sends
// what to read here first and then opens the event stream with the id it gets back.
async function saveInput(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Node never reads a body past its Content-Length, so checking the header caps the upload.
  // A request without one is turned away too.
  if (!(Number(req.headers["content-length"]) <= MAX_INPUT_BYTES)) {
    return reply(res, 413, "text/plain", "Paste at most 1 MB of text.");
  }
  const input = (await text(req)).trim();
  if (!input) return reply(res, 400, "text/plain", "Paste a link or the text of an article first.");
  const id = randomUUID();
  inputs.set(id, input);
  reply(res, 200, "application/json", JSON.stringify({ id }));
}

// Reads the article aloud, streaming each paragraph to the page as a server-sent event as soon as it's
// recorded, with the time of every word.
async function readAloud(inputId: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A paragraph can still finish after another one has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop recording if the page is closed or stopped, or if a paragraph fails while others are recording.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // Each input makes one run, so a reconnecting EventSource can't start a second one.
  const input = inputs.get(inputId);
  inputs.delete(inputId);
  const id = randomUUID();
  const started = Date.now();
  let cost = 0;
  try {
    if (!input) throw new Error("There's nothing to read. Paste the link or the text again.");
    // Only a link is fetched. Anything else is read as the article's text, never as a path on disk.
    const link = /^https?:\/\/\S+$/.test(input) ? input : null;
    const article = link ? await readArticle(link, abort.signal) : fromText(input);
    emit("article", { ...article, link, voice: VOICE });

    const recordings = await recordAll(
      article.paragraphs,
      {
        recording: (index) => emit("recording", { index }),
        recorded: (index, recording) => {
          const url = `/audio/${id}/${index + 1}.mp3`;
          clips.set(url, recording.audio);
          cost += article.paragraphs[index].length * COST_PER_CHARACTER;
          emit("recorded", { index, url, duration: recording.duration, words: recording.words, cost });
        },
      },
      abort.signal,
    );
    const download = `/audio/${id}/article.mp3`;
    clips.set(download, Buffer.concat(recordings.map((recording) => recording.audio)));
    emit("done", { download, cost, seconds: (Date.now() - started) / 1000 });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error), cost });
    abort.abort();
  }
  res.end();
}

// Browsers load audio in byte ranges, and Chrome won't seek in audio it can't load that way.
function sendAudio(req: IncomingMessage, res: ServerResponse, bytes: Uint8Array): void {
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return reply(res, 200, "audio/mpeg", bytes, { "accept-ranges": "bytes" });
  const start = Number(range[1]);
  const end = Math.min(Number(range[2] || Infinity), bytes.length - 1);
  if (start > end) return reply(res, 416, "text/plain", "", { "content-range": `bytes */${bytes.length}` });
  reply(res, 206, "audio/mpeg", bytes.subarray(start, end + 1), { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${bytes.length}` });
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...headers }).end(body);
}
