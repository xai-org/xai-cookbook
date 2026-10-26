import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { APIConnectionError, APIError, SpaceXAI, TimeoutError, type VideoGenerateParams, type VideoResponse, stripInvalidSpeechTags } from "@xai-official/sdk";
import type { Gesture, Mood } from "./script.ts";

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

// How the presenter reacts, by the part's mood. The reactions are kept small: big ones in every take read as acting.
const DIRECTIONS: Record<Mood, string> = {
  chill: "Relaxed and conversational.",
  shocked: "Genuinely surprised on the first words: eyebrows up and eyes wide for a moment, then they settle and go on.",
  smug: "Quietly pleased with how this turned out, with a small smirk that comes and goes.",
  facepalm: "Disappointed: a hand goes to their forehead for a moment, then they drop it and say the line.",
};
// The one small thing the presenter does in a take, by the gesture Grok picked for it.
const GESTURE_DIRECTIONS: Record<Exclude<Gesture, "none" | "point">, string> = {
  count: "They count the points off on their fingers as they say them.",
  lean: "Partway through, they lean in toward the lens, as if letting the viewer in on a secret.",
  remember: "Their eyes flick up and to the side for a moment, as if remembering, before they go on.",
  laugh: "A short, real half-laugh before the line, at how absurd it is.",
  shrug: "A small shrug, palms up, partway through.",
  nod: "They nod slightly along with what they're saying.",
  hands: "They talk with their hands: small, natural movements, not big gestures.",
  sigh: "A quick exhale through the nose first, a little exasperated.",
  squint: "They squint at the lens for a moment, skeptical.",
  headshake: "A small, slow shake of the head, in disbelief.",
  glance: "They glance away from the lens for a second, as if checking something, then back.",
};

// What the presenter says and how, the small thing they do as they say it, and what's on screen above them that they
// point at, if they point. `acting` is how this one take is acted, in place of the personality's delivery.
export type Part = { line: string; mood: Mood; gesture?: Exclude<Gesture, "none" | "point">; pointAt?: string; acting?: string };
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
    const natural = await mostNatural(takes.filter((take) => !take.cutOff && take.tinted <= DOUBLED && take.matched >= best.matched - 1), base, signal).catch(() => ({ take: undefined, cost: 0 }));
    return keep(natural.take ?? best, filmed, cost + natural.cost);
  }
}

const NATURAL = `You're a video editor choosing between takes of the same person saying the same line into their phone's camera. Each take comes as three frames, from its start, middle, and end. Pick the take that looks most like a real person filming themselves, and least like AI video. Watch for a frozen or fixed smile, eyes that stare without blinking, a stiff or posed body, hands or fingers that warp or move unnaturally, a doubled or smeared face, teeth that look wrong, a mouth that doesn't look mid-word, skin that looks like plastic, and light that changes for no reason. If they're about the same, pick the one with the more natural expression.`;
const NATURAL_SCHEMA = { type: "object", properties: { pick: { type: "integer" }, why: { type: "string" } }, required: ["pick", "why"], additionalProperties: false };

// Of takes that say the line about as well, Grok keeps the one that looks most like a real person, from three frames of
// each. The pick is saved as <base>-natural.json, so filming again with the same takes keeps the same one instead of
// asking again, and maybe getting another answer.
async function mostNatural(takes: Filmed[], base: string, signal?: AbortSignal): Promise<{ take?: Filmed; cost: number }> {
  if (takes.length < 2) return { cost: 0 };
  const files = takes.map((take) => take.file).sort();
  const saved = `${base}-natural.json`;
  const kept = existsSync(saved) ? await readFile(saved, "utf8").then((text) => JSON.parse(text) as { files: string[]; pick: string }, () => undefined) : undefined;
  if (kept && kept.files.join() === files.join()) return { take: takes.find((take) => take.file === kept.pick), cost: 0 };
  const content = await Promise.all(
    takes.map(async (take, index) => {
      const [from, to] = [take.heard[0]?.start ?? 0, take.heard.at(-1)?.end ?? 1];
      const frames = await Promise.all([0.2, 0.5, 0.8].map((at) => stillAt(take.file, from + (to - from) * at, signal)));
      return [{ type: "input_text" as const, text: `Take ${index + 1}:` }, ...frames.map((image) => ({ type: "input_image" as const, image, detail: "high" as const }))];
    }),
  );
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: NATURAL },
        { role: "user", content: content.flat() },
      ],
      text: { format: { type: "json_schema", name: "natural", schema: NATURAL_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { pick } = response.toJson() as { pick: number };
  const take = takes[Math.min(Math.max(Math.round(pick), 1), takes.length) - 1];
  await writeFile(saved, JSON.stringify({ files, pick: take.file }));
  return { take, cost: response.usage.cost_usd ?? 0 };
}

// A frame of a take at `time`, as a small JPEG.
async function stillAt(file: string, time: number, signal?: AbortSignal): Promise<Blob> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", time.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=360:640", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 24, signal });
  return new Blob([stdout], { type: "image/jpeg" });
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

// How the presenter reacts to a clip they're watching, by the mood of the part that answers it.
const REACTIONS: Record<Mood, string> = {
  chill: "a small nod and a slight smile, interested",
  shocked: "their eyebrows rising as they take in what they're hearing",
  smug: "a knowing little smirk, as if they saw this coming",
  facepalm: "a slow wince, then a small shake of the head",
};

// Films the presenter watching a clip on their phone and reacting to it without a word, for as long as the clip plays
// before their line, the way a creator stitches someone else's video. It's one take, with no voice, saved as `file`, and
// one filmed there before is used again.
export async function recordReaction(mood: Mood, cast: Cast, seconds: number, file: string, onProgress: (percent: number) => void = () => {}, signal?: AbortSignal): Promise<{ file: string; cost: number }> {
  if (existsSync(file)) return { file, cost: 0 };
  const prompt = [
    `The person in the picture films a TikTok in ${cast.room}, reacting to a video. It's one continuous shot that starts from the picture, with the same face, hair, clothes, and surroundings throughout, and no cut to anywhere else. Handheld vertical phone video, like a real creator.`,
    `They watch the video on their phone's screen, just below the lens, without saying a word: they listen, and react with their face, ${REACTIONS[mood]}. They blink and breathe naturally, and their mouth stays closed.`,
    "Nobody speaks, and there's no music.",
  ].join("\n");
  return { file, cost: await filmTake(prompt, { ...cast, voice: "" }, Math.max(3, Math.ceil(seconds)), file, onProgress, signal) };
}

// What's said in the first `seconds` of a clip, word by word, to caption it while it plays with its own sound. It's saved
// next to the clip. A clip with no sound has no words.
export async function hearClip(file: string, seconds: number, signal?: AbortSignal): Promise<Array<{ text: string; start: number; end: number }>> {
  const saved = `${file.replace(/\.mp4$/, "")}-heard-${seconds.toFixed(2)}.json`;
  if (existsSync(saved)) return JSON.parse(await readFile(saved, "utf8"));
  const dir = await mkdtemp(join(tmpdir(), "clip-"));
  try {
    const failed = await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-t", seconds.toFixed(3), "-vn", "-c:a", "aac", "-b:a", "96k", `${dir}/sound.m4a`], { signal }).then(() => false, () => true);
    if (failed && !signal?.aborted) return [];
    const words = (await client.voice.transcribe({ file: new File([await readFile(`${dir}/sound.m4a`)], "clip.m4a"), model: "grok-voice-transcribe-2.0" }, { signal })).words ?? [];
    await writeFile(saved, JSON.stringify(words));
    return words;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  return { file, cost: await filmTake(takePrompt({ line, mood: "chill" }, cast), cast, seconds, file, onProgress, signal) };
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
  const filmed = saved ? 0 : await filmTake(prompt, cast, seconds, file, onProgress, signal);
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
    cost: filmed + (transcribed ? seconds * TRANSCRIPTION_USD_PER_SECOND : 0),
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
function takePrompt({ line, mood, gesture, pointAt, acting }: Part, { room, delivery }: Cast): string {
  return [
    `The person in the picture films a TikTok in ${room}, talking straight into the phone camera. It's one continuous shot that starts from the picture, with the same face, hair, clothes, and surroundings throughout, and no cut to anywhere else. Handheld vertical phone video, like a real creator: the framing drifts a little, and the exposure shifts slightly as they move.`,
    "They're a real person, not a presenter: they blink and breathe naturally, take a small breath before they start talking, now and then their eyes go to the screen just below the lens for a moment, and their face follows what they're saying, with no fixed smile.",
    `They say, in the voice from <AUDIO_0>: "${line}"`,
    acting ? `How they act this take: ${acting}` : `Their energy and pace, without making the same moves in every take: ${delivery}`,
    DIRECTIONS[mood],
    gesture ? GESTURE_DIRECTIONS[gesture] : "",
    pointAt ? `As they start, they point up toward the top of the frame for a moment, at ${pointAt} shown above them.` : "",
    "Their mouth moves with the words. Nobody else speaks, and there's no music.",
  ]
    .filter(Boolean)
    .join("\n");
}

// The video's URL is temporary, so it's downloaded right away. The video is made and paid for by now, so a dropped
// connection, which fetch throws as a TypeError, is tried again, up to twice.
async function download(result: VideoResponse, file: string, signal?: AbortSignal, tries = 3): Promise<void> {
  const url = result.video?.url;
  if (!url) throw new Error("A video didn't pass moderation, so there's nothing to download.");
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Couldn't download a video: ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (!(error instanceof TypeError) || signal?.aborted) throw error;
    if (tries === 1) {
      const reason = error.cause instanceof Error ? error.cause.message : error.message;
      const host = new URL(url).host;
      throw new Unreachable(`A finished video couldn't be downloaded from ${host} (${reason}). It's paid for, and filming again picks it up once this computer can reach ${host}.`);
    }
    await sleep(2000, undefined, { signal });
    return download(result, file, signal, tries - 1);
  }
}

// A finished video this computer can't download, like behind a firewall that blocks where the videos are.
class Unreachable extends Error {}

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

// Films a take into `file`, starting from the portrait, in the voice from reference_audios as <AUDIO_0>, and returns what
// it cost.
function filmTake(prompt: string, { portrait, voice }: Cast, seconds: number, file: string, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<number> {
  return filmVideo(
    {
      model: "grok-imagine-video-1.5",
      prompt,
      image: portrait,
      // A take with no voice, like a reaction, has nobody to sound like.
      ...(voice ? { reference_audios: [{ voice_id: voice }] } : {}),
      duration: seconds,
      aspect_ratio: "9:16",
      resolution: "720p",
    },
    file,
    onProgress,
    signal,
  );
}

// Films a video with Grok Imagine into `file`, and returns what it cost. A video is billed from the moment it starts,
// whether or not it's ever downloaded, so its request is saved next to `file` as <name>-request.json right away, and
// filming again after a run that stopped partway, like when the server restarted, picks the video up instead of paying
// for another. One that failed, or is too old to download, is filmed again, but not one this computer can't download,
// since another would be paid for and fail the same way.
export async function filmVideo(body: VideoGenerateParams, file: string, onProgress: (percent: number) => void = () => {}, signal?: AbortSignal): Promise<number> {
  const started = file.replace(/\.mp4$/, "-request.json");
  if (existsSync(started)) {
    const { request_id } = JSON.parse(await readFile(started, "utf8")) as { request_id: string };
    const cost = await finish(request_id, file, started, onProgress, signal).catch((error: unknown) => {
      if (signal?.aborted || error instanceof Unreachable) throw error;
      return undefined;
    });
    if (cost !== undefined) return cost;
  }
  const { request_id } = await startVideo(body, signal);
  await writeFile(started, JSON.stringify({ request_id }));
  return finish(request_id, file, started, onProgress, signal);
}

// Waits for a video to be made, downloads it to `file`, and forgets its request.
async function finish(request_id: string, file: string, started: string, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<number> {
  const result = await waitFor(request_id, onProgress, signal);
  await download(result, file, signal);
  await rm(started, { force: true });
  return result.usage?.cost_usd ?? 0;
}

// videos.wait() polls until the video is done but doesn't say how far along it is, so this polls videos.get() itself. A
// poll that fails because the network dropped or the API was busy is tried again for as long as a video can take, since
// the video keeps rendering either way.
async function waitFor(request_id: string, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<VideoResponse> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await client.videos.get(request_id, { signal }).catch((error: unknown) => {
      if (passing(error, signal)) return undefined;
      throw error;
    });
    if (result?.status === "done") return result;
    if (result && result.status !== "pending") throw new Error(`A video ${result.status}: ${result.error?.message ?? "no reason given"}`);
    if (result) onProgress(result.progress ?? 0);
    await sleep(result ? 3000 : 10_000, undefined, { signal });
  }
  throw new Error(`A video wasn't done after ${MAX_WAIT_MS / 60_000} minutes. Its request ID is ${request_id}.`);
}

// Whether an error is one that passes, like the network dropping or the API being busy, so asking again is worth it.
function passing(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || !APIError.is(error) || error.isAbort()) return false;
  return error instanceof APIConnectionError || error instanceof TimeoutError || error.isRateLimit() || error.isOverloaded() || (error.status ?? 0) >= 500;
}

// The SDK doesn't resend a request that creates something when the connection drops before the API answers, since the
// first one might have gone through. Starting all the takes at once sometimes drops a connection, so a video that never
// got an answer is started again, up to twice.
async function startVideo(body: VideoGenerateParams, signal?: AbortSignal, tries = 3): Promise<{ request_id: string }> {
  try {
    return await client.videos.generate(body, { signal });
  } catch (error) {
    if (!(error instanceof APIConnectionError) || tries === 1) throw error;
    return startVideo(body, signal, tries - 1);
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
