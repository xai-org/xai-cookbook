import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import { SAMPLE_PATH, SAMPLE_RATE, recordSampleMeeting } from "./audio.ts";
import { type Meeting, ask, startMeeting } from "./meeting.ts";
import { notesMarkdown } from "./notes.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const TYPES: Record<string, string> = { ".wav": "audio/wav", ".md": "text/markdown; charset=utf-8" };
const meetings = new Map<string, Meeting>();
const files = new Map<string, string>();
// The page opens a meeting's event stream first, then sends its audio over a WebSocket with the id it
// gets back. Node has no WebSocket server built in, so the ws package takes those connections.
const waitingForAudio = new Map<string, (socket: WebSocket) => void>();
const audioSockets = new WebSocketServer({ noServer: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/meeting") return streamMeeting(url.searchParams.has("sample"), res);
  if (url.pathname === "/api/answer") return streamAnswer(url.searchParams.get("meeting") ?? "", url.searchParams.get("question") ?? "", res);

  const file = files.get(url.pathname);
  if (file) return sendFile(req, res, file);
  reply(res, 404, "text/plain", "Not found");
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("meeting") ?? "";
  const accept = url.pathname === "/api/audio" ? waitingForAudio.get(id) : undefined;
  if (!accept) return socket.destroy();
  waitingForAudio.delete(id);
  audioSockets.handleUpgrade(req, socket, head, accept);
});

server.listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Runs a meeting while streaming its captions and notes to the page as server-sent events. The meeting
// ends when the page closes the audio socket.
async function streamMeeting(sample: boolean, res: ServerResponse): Promise<void> {
  const { emit, signal } = eventStream(res);
  const id = randomUUID();
  let audio: WebSocket | undefined;
  try {
    if (sample && !existsSync(SAMPLE_PATH)) emit("recording", {});
    const recording = sample ? await recordSampleMeeting(signal) : 0;

    const connected = new Promise<WebSocket>((resolve, reject) => {
      waitingForAudio.set(id, resolve);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    emit("meeting", { id, sample: sample ? publish(id, SAMPLE_PATH) : null });
    audio = await connected;

    const meeting = await startMeeting(
      SAMPLE_RATE,
      {
        interim: (text) => emit("interim", { text }),
        line: (line, open) => emit("line", { ...line, open }),
        revising: (lines) => emit("revising", { lines: lines.map((line) => line.id) }),
        change: (list, item) => emit("change", { list, item }),
        speakers: (speakers) => emit("speakers", { speakers }),
        notes: (notes) => emit("notes", { notes, cost: meeting.cost.notes }),
        error: (error) => {
          console.error(`Couldn't revise the notes: ${error.message}`);
          emit("revision-failed", { message: error.message });
        },
      },
      signal,
    );
    meetings.set(id, meeting);
    audio.on("message", (data, isBinary) => {
      if (isBinary) meeting.send(data as Buffer);
    });
    emit("listening", {});

    // A broken transcription ends the meeting too, with an error.
    await Promise.race([once(audio, "close"), meeting.done]);
    emit("finishing", {});
    await meeting.finish();
    const path = `output/meeting-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.md`;
    await mkdir("output", { recursive: true });
    await writeFile(path, notesMarkdown(sample ? "Notes on the sample meeting" : "Meeting notes", meeting.notes, meeting.lines));
    emit("done", { cost: { ...meeting.cost, recording }, download: publish(id, path) });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  waitingForAudio.delete(id);
  audio?.terminate();
  res.end();
}

// Answers a question about a meeting, during it or after, streaming the answer as server-sent events.
async function streamAnswer(id: string, question: string, res: ServerResponse): Promise<void> {
  const { emit, signal } = eventStream(res);
  try {
    const meeting = meetings.get(id);
    if (!meeting) throw new Error("That meeting is gone. Start a new one.");
    const { cost } = await ask(
      meeting,
      question.slice(0, 500),
      { reasoning: (text) => emit("reasoning", { text }), text: (text) => emit("text", { text }) },
      signal,
    );
    emit("done", { cost });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

// Starts a stream of server-sent events, with a signal that aborts if the page closes it early.
function eventStream(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  // A revision can still finish after the meeting has failed and the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return { emit, signal: abort.signal };
}

// Only files a run wrote get a URL, so no other file on disk can be requested.
function publish(id: string, path: string): string {
  const url = `/files/${id}/${basename(path)}`;
  files.set(url, path);
  return url;
}

// Browsers load audio in byte ranges, and Safari won't play it without them.
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

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...headers }).end(body);
}
