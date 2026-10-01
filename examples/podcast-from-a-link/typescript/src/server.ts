import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type ServerResponse, createServer } from "node:http";
import { HOSTS, limit, readSource, recordLine, writeScript } from "./podcast.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGE = new URL("../public/index.html", import.meta.url);
const episodes = new Map<string, Uint8Array[]>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", await readFile(PAGE));
  if (url.pathname === "/api/episode") return makeEpisode(url.searchParams.get("source") ?? "", res);

  const audio = url.pathname.match(/^\/audio\/([\w-]+)\/(\d+|episode)\.mp3$/);
  const clips = audio ? episodes.get(audio[1]) : undefined;
  const bytes = audio?.[2] === "episode" && clips ? Buffer.concat(clips) : clips?.[Number(audio?.[2])];
  if (bytes) return reply(res, 200, "audio/mpeg", bytes);
  reply(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}`));

// Makes the episode while streaming its progress to the page as server-sent events.
async function makeEpisode(source: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop making API calls if the page is closed before the episode is done.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const id = randomUUID();
  const clips: Uint8Array[] = [];
  episodes.set(id, clips);
  const record = limit(4);
  const recordings: Array<Promise<void>> = [];
  let writing = false;
  const startWriting = () => {
    if (writing) return;
    writing = true;
    emit("step", { step: "think", status: "done" });
    emit("step", { step: "write", status: "active" });
  };

  try {
    const material = await readSource(source, abort.signal);
    emit("step", { step: "think", status: "active" });

    await writeScript(
      material,
      {
        reasoning: (text) => emit("reasoning", { text }),
        title: (title) => {
          startWriting();
          emit("title", { title });
        },
        line: (line, index) => {
          startWriting();
          emit("line", { index, speaker: line.speaker, name: HOSTS[line.speaker].name, text: line.text });
          recordings.push(
            record(async () => {
              clips[index] = await recordLine(line, abort.signal);
              emit("audio", { index, url: `/audio/${id}/${index}.mp3` });
            }),
          );
        },
      },
      abort.signal,
    );
    emit("step", { step: "write", status: "done" });

    await Promise.all(recordings);
    emit("done", { download: `/audio/${id}/episode.mp3` });
  } catch (error) {
    if (!abort.signal.aborted) emit("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
