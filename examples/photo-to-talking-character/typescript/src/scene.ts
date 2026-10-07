import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { SpaceXAI, type VideoResponse, type Voice, stripInvalidSpeechTags } from "@xai-official/sdk";

const client = new SpaceXAI();

// The video model takes the text-to-speech voices by voice_id, except these two, which it answers
// with "Unknown voice_id".
const NOT_FOR_VIDEO = ["aurora", "liora"];
const MAX_WAIT_MS = 10 * 60_000;

export type Character = { image: Blob; voice: string; line: string };
export type Scene = { dir: string; prompt: string; seconds: number; cost: number };
export type SceneEvents = {
  started?: (prompt: string, seconds: number) => void;
  progress?: (percent: number) => void;
};

export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const { voices } = await client.voice.list({ signal });
  return voices.filter((voice) => !NOT_FOR_VIDEO.includes(voice.voice_id));
}

// Says the text in a voice, so people can hear it before they pay for a video.
export async function previewVoice(voice: string, text: string, signal?: AbortSignal): Promise<Uint8Array> {
  const speech = await client.voice.speak(
    { text: stripInvalidSpeechTags(text), language: "auto", voice_id: voice },
    { signal },
  );
  return speech.bytes();
}

// One prompt for the whole scene. It refers to each character by its place in reference_images and
// reference_audios: the first character's picture is <IMAGE_0> and its voice is <AUDIO_0>.
export function writePrompt(lines: string[]): string {
  const cast = lines.map((_, index) => `the character from <IMAGE_${index}>`);
  const scene =
    lines.length === 1
      ? "The character from <IMAGE_0> comes to life and talks to the camera, keeping the exact look and art style of its picture."
      : `${capitalize(new Intl.ListFormat("en").format(cast))} come to life together in one scene and talk to each other, each keeping the exact look and art style of its picture.`;
  const script = lines.map((line, index) => {
    const speaker = lines.length === 1 ? "It" : `${index === 0 ? "First" : "Then"} ${cast[index]}`;
    return `${speaker} says, in the voice from <AUDIO_${index}>: "${line}"`;
  });
  return [scene, ...script, "The speaker's mouth moves with the words. Nobody else speaks, and there's no music."].join("\n");
}

// Characters speak three or four words a second. Allowing three, plus a second before each line and one
// to end on, keeps the last line from being cut off. Every second is billed, so there's no more slack.
export function sceneLength(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.min(15, Math.max(5, Math.ceil(words / 3 + lines.length + 1)));
}

// Makes one video of the characters saying their lines, in order, and saves it to output/<first line>/.
export async function makeScene(cast: Character[], on: SceneEvents = {}, signal?: AbortSignal): Promise<Scene> {
  const lines = cast.map((character) => character.line);
  const prompt = writePrompt(lines);
  const seconds = sceneLength(lines);
  const { request_id } = await client.videos.generate(
    {
      model: "grok-imagine-video-1.5",
      prompt,
      reference_images: cast.map((character) => character.image),
      reference_audios: cast.map((character) => ({ voice_id: character.voice })),
      duration: seconds,
      aspect_ratio: "16:9",
      resolution: "720p",
    },
    { signal },
  );
  on.started?.(prompt, seconds);

  const result = await waitForVideo(request_id, on.progress, signal);
  if (result.status !== "done") throw new Error(`The video ${result.status}: ${result.error?.message ?? "no reason given"}`);
  if (!result.video?.url) throw new Error("The video didn't pass moderation, so there's nothing to download.");
  const video = await fetch(result.video.url, { signal });
  if (!video.ok) throw new Error(`Couldn't download the video: ${video.status}`);

  const dir = `output/${slugify(lines[0])}`;
  const cost = result.usage?.cost_usd ?? 0;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/scene.mp4`, Buffer.from(await video.arrayBuffer()));
  await writeFile(`${dir}/scene.json`, JSON.stringify({ prompt, voices: cast.map((character) => character.voice), seconds, cost }, null, 2));
  return { dir, prompt, seconds, cost };
}

// videos.wait() polls until the video is done but doesn't say how far along it is, so this polls
// videos.get() itself and passes on the percentage the API reports.
async function waitForVideo(requestId: string, progress?: (percent: number) => void, signal?: AbortSignal): Promise<VideoResponse> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await client.videos.get(requestId, { signal });
    if (result.status !== "pending") return result;
    progress?.(result.progress ?? 0);
    await sleep(3000, undefined, { signal });
  }
  throw new Error(`The video wasn't done after ${MAX_WAIT_MS / 60_000} minutes. Its request ID is ${requestId}.`);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "scene";
}
