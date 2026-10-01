import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { type UnsafeSpeechText, xAI } from "@xai-official/sdk";

const client = new xAI();

const VOICE = "ara";

export type Brief = { product: string; scenes: string[]; motion: string; tagline: string; voiceover: string };
export type Pick = { best: number; reason: string };
export type Ad = { dir: string; brief: Brief; pick: Pick; finalCut: boolean; cost: number };

export type AdEvents = {
  step?: (step: "brief" | "scenes" | "pick" | "video") => void;
  brief?: (brief: Brief) => void;
  scene?: (index: number, path: string) => void;
  pick?: (pick: Pick) => void;
};

const BRIEF_PROMPT = `You're the creative director for a short vertical video ad.
Look at the product photo and the description, then write a brief:
- product: the product's name, in a few words.
- scenes: three different lifestyle settings where this product would look its best, each one sentence. Describe the setting, props, and light, not the product itself.
- motion: one sentence on how the camera moves in the ad and what we hear.
- tagline: at most eight words.
- voiceover: one or two spoken sentences, at most 20 words, that end with the tagline.`;

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    product: { type: "string" },
    scenes: { type: "array", items: { type: "string" } },
    motion: { type: "string" },
    tagline: { type: "string" },
    voiceover: { type: "string" },
  },
  required: ["product", "scenes", "motion", "tagline", "voiceover"],
  additionalProperties: false,
};

const PICK_SCHEMA = {
  type: "object",
  properties: {
    best: { type: "integer", description: "The number of the best frame, starting at 1" },
    reason: { type: "string" },
  },
  required: ["best", "reason"],
  additionalProperties: false,
};

// Makes the ad and saves it to output/<product>/, reporting each step as it starts and
// each result as soon as it's ready.
export async function makeAd(photo: Blob, description: string, on: AdEvents = {}, signal?: AbortSignal): Promise<Ad> {
  on.step?.("brief");
  const brief = await writeBrief(photo, description, signal);
  on.brief?.(brief);
  const dir = `output/${slugify(brief.product)}`;
  await mkdir(dir, { recursive: true });

  on.step?.("scenes");
  const scenes = await Promise.all(
    brief.scenes.map(async (scene, index) => {
      const placed = await placeProduct(photo, scene, signal);
      const path = `${dir}/scene-${index + 1}.jpg`;
      await writeFile(path, await placed.image.bytes());
      on.scene?.(index, path);
      return placed;
    }),
  );

  on.step?.("pick");
  const pick = await pickBest(photo, scenes.map((scene) => scene.image), brief, signal);
  on.pick?.(pick);

  on.step?.("video");
  const [video, voiceover] = await Promise.all([
    animate(scenes[pick.best - 1].image, brief.motion, signal),
    narrate(brief.voiceover, signal),
  ]);
  await writeFile(`${dir}/ad.mp4`, video.bytes);
  await writeFile(`${dir}/voiceover.mp3`, voiceover);
  const finalCut = addVoiceover(dir);
  await writeFile(`${dir}/brief.json`, JSON.stringify({ ...brief, pick }, null, 2));
  return { dir, brief, pick, finalCut, cost: scenes.reduce((sum, scene) => sum + scene.cost, video.cost) };
}

async function writeBrief(photo: Blob, description: string, signal?: AbortSignal): Promise<Brief> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: BRIEF_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_image", image: photo, detail: "high" },
            { type: "input_text", text: description },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "ad_brief", schema: BRIEF_SCHEMA } },
    },
    { signal },
  );
  const brief = response.toJson() as Brief;
  return { ...brief, scenes: brief.scenes.slice(0, 3) };
}

async function placeProduct(photo: Blob, scene: string, signal?: AbortSignal): Promise<{ image: Blob; cost: number }> {
  const result = await client.images.edit(
    {
      model: "grok-imagine-image-2.0",
      image: photo,
      prompt: `Place the product from this photo in a new setting: ${scene} Keep the product's shape, colors, and details exactly as they are. Commercial product photography, vertical frame.`,
      aspect_ratio: "9:16",
      response_format: "b64_json",
    },
    { signal },
  );
  const b64 = result.data[0]?.b64_json;
  if (!b64) throw new Error("The image response had no image data");
  return { image: new Blob([Buffer.from(b64, "base64")], { type: "image/jpeg" }), cost: result.usage?.cost_usd ?? 0 };
}

async function pickBest(photo: Blob, scenes: Blob[], brief: Brief, signal?: AbortSignal): Promise<Pick> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image: photo },
            ...scenes.map((image) => ({ type: "input_image" as const, image })),
            {
              type: "input_text",
              text: `The first image is the original product photo. The next ${scenes.length} are candidate frames 1 to ${scenes.length} for a video ad for ${brief.product}, with the tagline "${brief.tagline}". Which frame sells the product best? Judge how clearly the product shows, how true it stays to the original photo, and how appealing the scene is.`,
            },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "pick", schema: PICK_SCHEMA } },
    },
    { signal },
  );
  const pick = response.toJson() as Pick;
  return { ...pick, best: Math.min(Math.max(pick.best, 1), scenes.length) };
}

async function animate(image: Blob, motion: string, signal?: AbortSignal): Promise<{ bytes: Buffer; cost: number }> {
  const { request_id } = await client.videos.generate(
    {
      model: "grok-imagine-video-1.5",
      prompt: motion,
      image,
      duration: 8,
      resolution: "720p",
    },
    { signal },
  );
  const result = await client.videos.wait(request_id, { signal });
  if (result.status !== "done" || !result.video?.url) {
    throw new Error(`The video failed to render: ${result.status} ${result.error?.message ?? ""}`);
  }
  const video = await fetch(result.video.url, { signal });
  if (!video.ok) throw new Error(`Couldn't download the video: ${video.status}`);
  return { bytes: Buffer.from(await video.arrayBuffer()), cost: result.usage?.cost_usd ?? 0 };
}

async function narrate(text: string, signal?: AbortSignal): Promise<Uint8Array> {
  // The model writes the voiceover, so the SDK can't check it for speech tags at compile time.
  const speech = await client.voice.speak({ text: text as UnsafeSpeechText, language: "en", voice_id: VOICE }, { signal });
  return speech.bytes();
}

// Lays the voiceover over the ad, with the ad's own sound turned down.
function addVoiceover(dir: string): boolean {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return false;
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-i", `${dir}/ad.mp4`,
    "-i", `${dir}/voiceover.mp3`,
    "-filter_complex", "[0:a]volume=0.3[bg];[1:a]adelay=500:all=1[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]",
    "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", `${dir}/final.mp4`,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  return true;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
}
