import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { APIConnectionError, SpaceXAI, type VideoResponse, stripInvalidSpeechTags } from "@xai-official/sdk";
import type { Mood } from "./script.ts";

// A video starts every take at once, so a rate limit is retried a few more times than the SDK's default of two.
const client = new SpaceXAI({ maxRetries: 5 });
const run = promisify(execFile);

// Each line is filmed this many times at once, and the take that says it best is kept, the way a director does.
export const TAKES_PER_LINE = 2;
// What a second of a take costs, for estimates before filming: every take so far has cost about 14 cents a second.
export const TAKE_USD_PER_SECOND = 0.14;
// Transcription is priced by the hour of audio (https://docs.x.ai/developers/pricing), and the API doesn't report what a
// request cost, so it's worked out from the length of the take.
const TRANSCRIPTION_USD_PER_SECOND = 0.1 / 3600;
const MAX_WAIT_MS = 10 * 60_000;
// The presenters say about 2.8 words a second, and start a moment into the take. Every second is billed, so a take is
// only a little longer than its line, and a take that cuts its line off is recorded again, longer.
const WORDS_PER_SECOND = 2.7;
// A take is trimmed to its words, keeping this much before the first and after the last, so the cuts land on the beat.
const BEFORE = 0.12;
const AFTER = 0.3;
// Grok Imagine sometimes films a doubled take, with a faint copy of the presenter mixed into the frame. In front of a
// green screen, the copy tints the green and turns the presenter see-through where they overlap, so it can't be keyed
// out. Clean takes have under 2% of their pixels tinted that way, and a doubled one had 8.5%.
const DOUBLED = 0.04;

const DIRECTIONS: Record<Mood, string> = {
  chill: "Relaxed and conversational, with a small smile.",
  shocked: "Their eyebrows shoot up and their jaw drops in disbelief on the first words.",
  smug: "A smug, knowing smirk, very pleased with how this turned out.",
  facepalm: "They shake their head and cover their face with one hand for a moment, disappointed, then say the line.",
};

// What the presenter says and how, and what's on screen above them that they point at, if anything. `acting` is how this
// one take is acted, in place of the personality's delivery.
export type Part = { line: string; mood: Mood; pointAt?: string; acting?: string };
// Who's on camera: the portrait every take starts from, the voice they speak in, where they film, and how their
// personality acts. `green` is the color of the green screen behind them, as hex, when they film in front of one.
export type Cast = { portrait: Blob; voice: string; room: string; delivery: string; green?: string };
// The take that was kept: its video, the part of it to use, and when each of the line's words is said, in seconds from the
// start of the take. `heard` is how much of the line its transcript matched.
export type Take = {
  file: string;
  prompt: string;
  start: number;
  end: number;
  words: number[];
  heard: number;
  seconds: number;
  filmed: number;
  cost: number;
};
type Filmed = { file: string; heard: Array<{ text: string; start: number; end: number }>; matched: number; cutOff: boolean; tinted: number; cost: number };

// Has Grok Imagine film the presenter saying the part's line, starting from the portrait, TAKES_PER_LINE times at once.
// Each take is transcribed, and the one whose transcript matches the most of the line is kept. If every take cuts the line
// off, they're all filmed again, longer, and if every take in front of a green screen is doubled, they're filmed again.
// Every take is saved as <base>-<letter>.mp4, with what was heard in it as <base>-<letter>.json, and one an earlier run
// saved there, like before the server restarted, is used again instead of filmed again. With `pick`, the take saved in
// that file is kept instead, as someone chose. With `more`, more takes are filmed after the ones saved, with that
// direction added, and the best of the new ones is kept.
export async function recordTake(
  part: Part,
  cast: Cast,
  base: string,
  onProgress: (percent: number) => void = () => {},
  signal?: AbortSignal,
  { pick, more }: { pick?: string; more?: string } = {},
): Promise<Take> {
  const prompt = more?.trim() ? `${takePrompt(part, cast)} Above all else in this take: ${more.trim()}` : takePrompt(part, cast);
  const words = part.line.split(/\s+/).filter(Boolean);
  let seconds = takeLength(words.length);
  const keep = (best: Filmed, filmed: number, cost: number): Take => {
    const start = Math.max(0, (best.heard[0]?.start ?? 0) - BEFORE);
    const end = Math.min(seconds, (best.heard.at(-1)?.end ?? seconds) + AFTER);
    return { file: best.file, prompt, start, end, words: timeWords(words, best.heard, start, end), heard: best.matched / words.length, seconds, filmed, cost };
  };
  if (pick) {
    const heard = await filmAndHear(prompt, cast, seconds, words, pick, onProgress, signal);
    return keep(heard, 0, heard.cost);
  }
  let filmed = more === undefined ? 0 : savedTakes(base).length;
  let cost = 0;
  for (let round = 0; ; round++) {
    const percents = Array<number>(TAKES_PER_LINE).fill(0);
    const takes = await Promise.all(
      percents.map((_, index) => {
        const file = `${base}-${String.fromCharCode(97 + filmed + index)}.mp4`;
        return filmAndHear(prompt, cast, seconds, words, file, (percent) => {
          percents[index] = percent;
          onProgress(Math.min(...percents));
        }, signal);
      }),
    );
    filmed += takes.length;
    cost += takes.reduce((sum, take) => sum + take.cost, 0);
    const best = takes.reduce((kept, take) => (score(take) > score(kept) ? take : kept));
    if (round < 1 && ((best.cutOff && seconds < 15) || best.tinted > DOUBLED)) {
      if (best.cutOff) seconds = Math.min(15, seconds + 2);
      continue;
    }
    return keep(best, filmed, cost);
  }
}

// A stand-in for a take, for a free preview: the portrait, still, with the line said in the presenter's voice by text to
// speech, for a fraction of a cent, and heard back to time the captions. It's saved as <base>.mp4, with its timing in
// <base>.json, and one saved there before is used again for nothing.
export async function speakTake(part: Part, cast: Cast, base: string, signal?: AbortSignal): Promise<Take> {
  if (existsSync(`${base}.mp4`) && existsSync(`${base}.json`)) return { ...JSON.parse(await readFile(`${base}.json`, "utf8")), cost: 0 };
  const words = part.line.split(/\s+/).filter(Boolean);
  const speech = await client.voice.speak({ text: stripInvalidSpeechTags(part.line), language: "auto", voice_id: cast.voice }, { signal });
  await writeFile(`${base}.mp3`, await speech.bytes());
  await writeFile(`${base}.jpg`, Buffer.from(await cast.portrait.arrayBuffer()));
  // The portrait fills a frame the size Grok Imagine films takes at, for as long as the line is said, and a moment more.
  const fill = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p";
  await run("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", `${base}.jpg`, "-i", `${base}.mp3`, "-vf", fill, "-af", `apad=pad_dur=${AFTER}`, "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-c:a", "aac", `${base}.mp4`], { signal });
  await Promise.all([rm(`${base}.mp3`), rm(`${base}.jpg`)]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${base}.mp4`]);
  const seconds = Number(stdout.trim());
  const heard = await hear(`${base}.mp4`, signal);
  const start = Math.max(0, (heard[0]?.start ?? 0) - BEFORE);
  const matched = lineUp(words, heard).filter((pair) => pair?.alike).length;
  const take = { file: `${base}.mp4`, prompt: "", start, end: seconds, words: timeWords(words, heard, start, seconds), heard: matched / words.length, seconds, filmed: 0, cost: seconds * TRANSCRIPTION_USD_PER_SECOND };
  await writeFile(`${base}.json`, JSON.stringify(take));
  return take;
}

// The takes saved for a line, in the order they were filmed.
export function savedTakes(base: string): string[] {
  const files: string[] = [];
  for (let index = 0; existsSync(`${base}-${String.fromCharCode(97 + index)}.mp4`); index++) files.push(`${base}-${String.fromCharCode(97 + index)}.mp4`);
  return files;
}

// Films one take of a line, with no retakes and no transcript, to try out a presenter before saving them.
export async function filmLine(line: string, cast: Cast, file: string, onProgress: (percent: number) => void = () => {}, signal?: AbortSignal): Promise<{ file: string; cost: number }> {
  const seconds = takeLength(line.split(/\s+/).filter(Boolean).length);
  const result = await filmTake(takePrompt({ line, mood: "chill" }, cast), cast, seconds, onProgress, signal);
  await download(result, file, signal);
  return { file, cost: result.usage?.cost_usd ?? 0 };
}

// How many seconds a take of the line is filmed for, which is about how long it runs in the video.
export function lineSeconds(line: string): number {
  return takeLength(line.split(/\s+/).filter(Boolean).length);
}

function takeLength(words: number): number {
  return Math.min(15, Math.max(3, Math.ceil(words / WORDS_PER_SECOND + 1)));
}

// A take that says more of the line wins, and one that cuts it off loses to one that doesn't. In front of a green screen,
// a doubled take loses to a clean one, and of two that say as much, the one with less tinted green wins.
function score(take: Filmed): number {
  return take.matched - (take.cutOff ? 1000 : 0) - (take.tinted > DOUBLED ? 100 : 0) - take.tinted;
}

async function filmAndHear(
  prompt: string,
  cast: Cast,
  seconds: number,
  words: string[],
  file: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Filmed> {
  const saved = existsSync(file);
  const result = saved ? undefined : await filmTake(prompt, cast, seconds, onProgress, signal);
  if (result) await download(result, file, signal);
  const { heard, transcribed } = await hearTake(file, signal);
  if (saved) onProgress(100);
  const last = heard.at(-1);
  return {
    file,
    heard,
    matched: lineUp(words, heard).filter((pair) => pair?.alike).length,
    // A take whose last word runs into its end, or that's missing a quarter of the line, stopped before the line did.
    cutOff: !last || heard.length < words.length * 0.75 || last.end > seconds - 0.25,
    tinted: cast.green ? await tintedShare(file, cast.green) : 0,
    cost: (result?.usage?.cost_usd ?? 0) + (transcribed ? seconds * TRANSCRIPTION_USD_PER_SECOND : 0),
  };
}

// The share of a green screen take's pixels that are tinted green without being the green screen: a little greener than
// the presenter, a little less than the screen. That's what a faint copy of the presenter mixed into the green looks
// like, while a clean take's pixels are almost all one or the other. Colors are compared the way ffmpeg's chromakey
// filter does, by the distance between their U and V, from 0 to 1, in two frames a second at a small size.
async function tintedShare(file: string, green: string): Promise<number> {
  const [width, height] = [180, 320];
  const vf = `fps=2,scale=${width}:${height},format=yuv444p`;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", vf, "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1 << 28 });
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(green.slice(at, at + 2), 16));
  const [keyU, keyV] = [128 - 0.16874 * r - 0.33126 * g + 0.5 * b, 128 + 0.5 * r - 0.41869 * g - 0.08131 * b];
  const plane = width * height;
  let tinted = 0;
  let pixels = 0;
  for (let frame = 0; frame + plane * 3 <= stdout.length; frame += plane * 3, pixels += plane) {
    for (let i = 0; i < plane; i++) {
      const distance = Math.hypot(stdout[frame + plane + i] - keyU, stdout[frame + plane * 2 + i] - keyV) / (255 * Math.SQRT2);
      if (distance >= 0.06 && distance < 0.1) tinted++;
    }
  }
  return pixels ? tinted / pixels : 0;
}

// One prompt per take. The portrait is the take's first frame, and the voice comes from reference_audios as <AUDIO_0>. The
// prompt names where the presenter films and asks for one continuous shot: told only that they film "at their desk", the
// presenter in a train compartment cut to a living room half a second in.
function takePrompt({ line, mood, pointAt, acting }: Part, { room, delivery }: Cast): string {
  return [
    `The person in the picture films a TikTok in ${room}, talking straight into the phone camera. It's one continuous shot that starts from the picture, with the same face, hair, clothes, and surroundings throughout, and no cut to anywhere else. Handheld vertical phone video, natural and expressive, like a real creator.`,
    `They say, in the voice from <AUDIO_0>: "${line}"`,
    `Their style: ${acting || delivery}`,
    DIRECTIONS[mood],
    pointAt ? `As they start, they point up toward the top of the frame for a moment, at ${pointAt} shown above them.` : "",
    "Their mouth moves with the words. Nobody else speaks, and there's no music.",
  ]
    .filter(Boolean)
    .join("\n");
}

// The video's URL is temporary, so it's downloaded right away. The take is made and paid for by now, so a dropped
// connection, which fetch throws as a TypeError, is tried again, up to twice.
async function download(result: VideoResponse, file: string, signal?: AbortSignal, tries = 3): Promise<void> {
  if (!result.video?.url) throw new Error("A take didn't pass moderation, so there's nothing to download.");
  try {
    const response = await fetch(result.video.url, { signal });
    if (!response.ok) throw new Error(`Couldn't download a take: ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (!(error instanceof TypeError) || signal?.aborted || tries === 1) throw error;
    await sleep(2000, undefined, { signal });
    return download(result, file, signal, tries - 1);
  }
}

// What's heard in a take, saved next to it as <take>.json, so a take kept for another cut, even by another run of the
// app, isn't transcribed again. A file that can't be read is heard again.
async function hearTake(file: string, signal?: AbortSignal): Promise<{ heard: Filmed["heard"]; transcribed: boolean }> {
  const saved = file.replace(/\.mp4$/, ".json");
  const kept = existsSync(saved) ? await readFile(saved, "utf8").then((text) => JSON.parse(text) as Filmed["heard"]).catch(() => undefined) : undefined;
  if (kept) return { heard: kept, transcribed: false };
  const heard = await hear(file, signal);
  await writeFile(saved, JSON.stringify(heard));
  return { heard, transcribed: true };
}

// What's heard in a take, word by word. Only its sound is uploaded, copied out of the take as it is: about 80 KB for a
// 5-second take instead of 3 MB of video, which came back with the same words at the same times. When the connection
// drops, the SDK only resends requests that just read something, and transcribing changes nothing, so it's sent again
// here, up to twice.
async function hear(file: string, signal?: AbortSignal): Promise<Filmed["heard"]> {
  const sound = await soundOf(file, signal);
  for (let tries = 3; ; tries--) {
    try {
      // The API reads the format from the file name.
      return (await client.voice.transcribe({ file: new File([sound], "take.m4a"), model: "grok-voice-transcribe-2.0" }, { signal })).words ?? [];
    } catch (error) {
      if (!(error instanceof APIConnectionError) || signal?.aborted || tries === 1) throw error;
      await sleep(2000, undefined, { signal });
    }
  }
}

async function soundOf(file: string, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>> {
  const dir = await mkdtemp(join(tmpdir(), "take-"));
  try {
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-c:a", "copy", `${dir}/sound.m4a`], { signal });
    return await readFile(`${dir}/sound.m4a`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function filmTake(prompt: string, { portrait, voice }: Cast, seconds: number, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<VideoResponse> {
  const { request_id } = await startTake(prompt, portrait, voice, seconds, signal);
  // videos.wait() polls until the video is done but doesn't say how far along it is, so this polls videos.get() itself.
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await client.videos.get(request_id, { signal });
    if (result.status === "done") return result;
    if (result.status !== "pending") throw new Error(`A take ${result.status}: ${result.error?.message ?? "no reason given"}`);
    onProgress(result.progress ?? 0);
    await sleep(3000, undefined, { signal });
  }
  throw new Error(`A take wasn't done after ${MAX_WAIT_MS / 60_000} minutes. Its request ID is ${request_id}.`);
}

// The SDK doesn't resend a request that creates something when the connection drops before the API answers, since the
// first one might have gone through. Starting all the takes at once sometimes drops a connection, so a take that never
// got an answer is started again, up to twice.
async function startTake(prompt: string, portrait: Blob, voice: string, seconds: number, signal?: AbortSignal, tries = 3): Promise<{ request_id: string }> {
  try {
    return await client.videos.generate(
      {
        model: "grok-imagine-video-1.5",
        prompt,
        image: portrait,
        reference_audios: [{ voice_id: voice }],
        duration: seconds,
        aspect_ratio: "9:16",
        resolution: "720p",
      },
      { signal },
    );
  } catch (error) {
    if (!(error instanceof APIConnectionError) || tries === 1) throw error;
    return startTake(prompt, portrait, voice, seconds, signal, tries - 1);
  }
}

// The transcript has the words as they were heard, which can mangle code names, like "on error" heard as "Onunka". So the
// line's words are lined up with the heard words the way a diff lines up two files: pairing two words that sound alike
// scores 2, and any other pair or a word left over costs 1. Each word of the line gets the heard word it pairs with, if any.
function lineUp(line: string[], heard: Array<{ text: string; start: number }>): Array<{ start: number; alike: boolean } | undefined> {
  const a = line.map(simplify);
  const b = heard.map((word) => simplify(word.text));
  const pair = (i: number, j: number) => (alike(a[i], b[j]) ? 2 : -1);
  // best[i][j] is the best score for lining up a[i..] with b[j..].
  const best = Array.from({ length: a.length + 1 }, (_, i) => Float64Array.from({ length: b.length + 1 }, (_, j) => -(a.length - i) - (b.length - j)));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) best[i][j] = Math.max(best[i + 1][j + 1] + pair(i, j), best[i + 1][j] - 1, best[i][j + 1] - 1);
  }
  const pairs: Array<{ start: number; alike: boolean } | undefined> = Array(line.length).fill(undefined);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (best[i][j] === best[i + 1][j + 1] + pair(i, j)) {
      pairs[i] = { start: heard[j].start, alike: alike(a[i], b[j]) };
      i++;
      j++;
    } else if (best[i][j] === best[i + 1][j] - 1) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// When each word of the line is said: the time of the heard word it pairs with, or for a word that pairs with nothing, a
// time between its neighbors'.
function timeWords(line: string[], heard: Array<{ text: string; start: number }>, start: number, end: number): number[] {
  const times = lineUp(line, heard).map((pair) => pair?.start);
  return line.map((_, index) => {
    if (times[index] !== undefined) return times[index];
    const before = times.findLastIndex((time, each) => each < index && time !== undefined);
    const after = times.findIndex((time, each) => each > index && time !== undefined);
    const [from, fromTime] = before < 0 ? [-1, start] : [before, times[before]!];
    const [to, toTime] = after < 0 ? [line.length, end] : [after, times[after]!];
    return fromTime + ((toTime - fromTime) * (index - from)) / (to - from);
  });
}

function simplify(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function alike(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3));
}
