import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { type ImageResponse, SpaceXAI, stripInvalidSpeechTags } from "@xai-official/sdk";

const client = new SpaceXAI();
const run = promisify(execFile);

const NARRATOR = "leo";
const SHOT_SECONDS = 8;

export const DEFAULT_PREMISE = "A paper boat's journey through a rainy city at night";

export type Shot = { scene: string; motion: string; narration: string };
export type Storyboard = { title: string; style: string; shots: Shot[] };
// An image or a video, and what it cost in US dollars.
export type Media = { bytes: Uint8Array<ArrayBuffer>; cost: number };

const STORYBOARD_PROMPT = `You're a director planning a short film of exactly four shots, ${SHOT_SECONDS} seconds each.
Follow one main subject through all four shots and tell a small story with a beginning, a turn, and an ending.

- title: a short title for the film.
- style: one sentence describing the look every shot shares: medium, color palette, and lighting.
- shots: exactly four, in order. For each one:
  - scene: what the frame shows, in one or two sentences. Describe the main subject the same way every time. Give each shot its own setting and camera angle or distance, like a wide shot, a close-up, or a view from above, and say which.
  - motion: one sentence on how the camera and the subject move, and what we hear.
  - narration: one sentence of voiceover, at most 14 words, so it fits in the shot.`;

const STORYBOARD_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    style: { type: "string" },
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scene: { type: "string" },
          motion: { type: "string" },
          narration: { type: "string" },
        },
        required: ["scene", "motion", "narration"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "style", "shots"],
  additionalProperties: false,
};

// Streams the plan so callers can show Grok's reasoning while it works.
export async function planStoryboard(
  premise: string,
  on: { reasoning?: (text: string) => void } = {},
  signal?: AbortSignal,
): Promise<Storyboard> {
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: STORYBOARD_PROMPT },
        { role: "user", content: premise },
      ],
      text: { format: { type: "json_schema", name: "storyboard", schema: STORYBOARD_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream.on("reasoning", (text) => on.reasoning?.(text)).done();
  const board = response.toJson() as Storyboard;
  return { ...board, shots: board.shots.slice(0, 4) };
}

// Reports each keyframe as soon as it's drawn: the first one, then the other three as they finish.
export async function drawKeyframes(
  board: Storyboard,
  on: { keyframe?: (frame: Media, index: number) => void | Promise<void> } = {},
  signal?: AbortSignal,
): Promise<Media[]> {
  const [first, ...rest] = board.shots;
  const generated = await client.images.generate(
    {
      model: "grok-imagine-image-2.0",
      prompt: `${board.style} ${first.scene}`,
      aspect_ratio: "16:9",
      response_format: "b64_json",
    },
    { signal },
  );
  const firstFrame = toMedia(generated);
  await on.keyframe?.(firstFrame, 0);

  // The other keyframes are edits of the first one, which keeps the subject and style consistent across
  // shots. An edit also keeps the composition unless it's told not to, and then the shots look like
  // versions of one picture.
  const edited = await Promise.all(
    rest.map(async (shot, index) => {
      const result = await client.images.edit(
        {
          model: "grok-imagine-image-2.0",
          image: toBlob(firstFrame),
          prompt: `Use this image only as a reference for the main subject and the art style. Draw a new scene with a different camera angle and composition: ${shot.scene}`,
          response_format: "b64_json",
        },
        { signal },
      );
      const frame = toMedia(result);
      await on.keyframe?.(frame, index + 1);
      return frame;
    }),
  );
  return [firstFrame, ...edited];
}

export async function animate(shot: Shot, keyframe: Media, signal?: AbortSignal): Promise<Media> {
  const { request_id } = await client.videos.generate(
    {
      model: "grok-imagine-video-1.5",
      prompt: shot.motion,
      image: toBlob(keyframe),
      duration: SHOT_SECONDS,
      resolution: "720p",
    },
    { signal },
  );
  const result = await client.videos.wait(request_id, { signal });
  if (result.status !== "done" || !result.video?.url) {
    throw new Error(`A shot failed to render: ${result.status} ${result.error?.message ?? ""}`);
  }
  const video = await fetch(result.video.url, { signal });
  if (!video.ok) throw new Error(`Couldn't download a shot: ${video.status}`);
  return { bytes: new Uint8Array(await video.arrayBuffer()), cost: result.usage?.cost_usd ?? 0 };
}

export async function narrate(text: string, signal?: AbortSignal): Promise<Uint8Array> {
  // The model writes the narration, so the SDK can't check its speech tags at compile time. Any tag the
  // voice API wouldn't recognize is removed instead, so it isn't read aloud.
  const speech = await client.voice.speak(
    { text: stripInvalidSpeechTags(text), language: "en", voice_id: NARRATOR },
    { signal },
  );
  return speech.bytes();
}

// Lays each narration over its shot, with the shot's own sound turned down, then joins the shots.
export async function assembleFilm(dir: string, count: number, signal?: AbortSignal): Promise<boolean> {
  const hasFfmpeg = await run("ffmpeg", ["-version"]).then(() => true, () => false);
  if (!hasFfmpeg) return false;
  const scenes: string[] = [];
  for (let index = 1; index <= count; index++) {
    const scene = `scene-${index}.mp4`;
    await ffmpeg(
      [
        "-i", `${dir}/shot-${index}.mp4`,
        "-i", `${dir}/narration-${index}.mp3`,
        "-filter_complex", "[0:a]volume=0.3[bg];[1:a]adelay=400:all=1[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]",
        "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", `${dir}/${scene}`,
      ],
      signal,
    );
    scenes.push(`file '${scene}'`);
  }
  const list = `${dir}/scenes.txt`;
  await writeFile(list, `${scenes.join("\n")}\n`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", `${dir}/film.mp4`], signal);
  return true;
}

async function ffmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  await run("ffmpeg", ["-y", "-v", "error", ...args], { signal });
}

function toMedia(image: ImageResponse): Media {
  const b64 = image.data[0]?.b64_json;
  if (!b64) throw new Error("The image response had no image data");
  return { bytes: Buffer.from(b64, "base64"), cost: image.usage?.cost_usd ?? 0 };
}

function toBlob(frame: Media): Blob {
  return new Blob([frame.bytes], { type: "image/jpeg" });
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "film";
}
