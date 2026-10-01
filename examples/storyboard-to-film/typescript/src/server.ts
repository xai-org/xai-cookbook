import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname } from "node:path";
import { pipeline } from "node:stream";
import { DEFAULT_PREMISE, animate, assembleFilm, drawKeyframes, narrate, planStoryboard, slugify } from "./storyboard.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
// The URL and path of every file the server has saved. It serves these files and nothing else.
const files = new Map<string, string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/film") return makeFilm(url.searchParams.get("premise") || DEFAULT_PREMISE, res);

  const path = files.get(url.pathname);
  if (path) return sendFile(req, res, path);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Makes the film while streaming its progress to the page as server-sent events.
async function makeFilm(premise: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // A shot that was saving when another one failed can finish after the response has ended.
  const emit = (event: string, data: object) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop making API calls if the page is closed before the film is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const id = randomUUID();
  let dir = "";
  const serve = (name: string) => {
    const url = `/files/${id}/${name}`;
    files.set(url, `${dir}/${name}`);
    return url;
  };
  const save = async (name: string, bytes: Uint8Array) => {
    await writeFile(`${dir}/${name}`, bytes);
    return serve(name);
  };

  try {
    emit("step", { step: "plan", status: "active" });
    const board = await planStoryboard(premise, { reasoning: (text) => emit("reasoning", { text }) }, abort.signal);
    emit("step", { step: "plan", status: "done" });
    emit("storyboard", board);
    dir = `output/${slugify(board.title)}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/storyboard.json`, JSON.stringify(board, null, 2));

    emit("step", { step: "draw", status: "active" });
    const keyframes = await drawKeyframes(
      board,
      {
        keyframe: async (frame, index) => {
          emit("keyframe", { index, url: await save(`keyframe-${index + 1}.jpg`, frame.bytes) });
        },
      },
      abort.signal,
    );
    let cost = keyframes.reduce((sum, frame) => sum + frame.cost, 0);

    emit("step", { step: "animate", status: "active" });
    await Promise.all([
      ...board.shots.map(async (shot, index) => {
        const video = await animate(shot, keyframes[index], abort.signal);
        cost += video.cost;
        emit("video", { index, url: await save(`shot-${index + 1}.mp4`, video.bytes) });
      }),
      ...board.shots.map(async (shot, index) => {
        const narration = await narrate(shot.narration, abort.signal);
        emit("narration", { index, url: await save(`narration-${index + 1}.mp3`, narration) });
      }),
    ]);

    emit("step", { step: "film", status: "active" });
    const hasFilm = await assembleFilm(dir, board.shots.length, abort.signal);
    emit("done", { film: hasFilm ? serve("film.mp4") : null, folder: dir, cost });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
    // Stop the other shots too, rather than pay for a film that won't be finished.
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

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
