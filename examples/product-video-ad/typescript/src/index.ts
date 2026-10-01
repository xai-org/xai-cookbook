import { spawnSync } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { type UnsafeSpeechText, xAI } from "@xai-official/sdk";

const client = new xAI();

const VOICE = "ara";

type Brief = { product: string; scenes: string[]; motion: string; tagline: string; voiceover: string };
type Pick = { best: number; reason: string };

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

let mediaCost = 0;

const photoPath = process.argv[2] ?? "sample-product.jpg";
const description = process.argv.slice(3).join(" ") || "A ceramic travel mug with a bamboo lid that keeps coffee hot for hours";
const photo = await openAsBlob(photoPath);

console.log("Writing the brief");
const brief = await writeBrief(photo, description);
console.log(`${brief.product}: "${brief.tagline}"`);
brief.scenes.forEach((scene, index) => console.log(`  ${index + 1}. ${scene}`));

const dir = `output/${slugify(brief.product)}`;
await mkdir(dir, { recursive: true });

console.log("\nPlacing the product in each scene");
const scenes = await Promise.all(brief.scenes.map((scene) => placeProduct(photo, scene)));
await Promise.all(scenes.map(async (scene, index) => writeFile(`${dir}/scene-${index + 1}.jpg`, await bytes(scene))));

console.log("Picking the strongest scene");
const pick = await pickBest(photo, scenes, brief);
console.log(`  Scene ${pick.best}: ${pick.reason}`);

console.log("Animating it and recording the voiceover. Video takes a minute or two.");
await Promise.all([
  animate(scenes[pick.best - 1], brief.motion, `${dir}/ad.mp4`),
  narrate(brief.voiceover, `${dir}/voiceover.mp3`),
]);

const hasFinalCut = addVoiceover(dir);
await writeFile(`${dir}/brief.json`, JSON.stringify({ ...brief, pick }, null, 2));
await writeFile(`${dir}/index.html`, adPage(brief, pick, hasFinalCut));
console.log(`\nSaved ${dir}/index.html${hasFinalCut ? ` and ${dir}/final.mp4` : ". Install ffmpeg to also get the ad with the voiceover in final.mp4."}`);
console.log(`Image and video cost: $${mediaCost.toFixed(2)}`);

async function writeBrief(photo: Blob, description: string): Promise<Brief> {
  const response = await client.responses.create({
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
  });
  const brief = response.toJson() as Brief;
  return { ...brief, scenes: brief.scenes.slice(0, 3) };
}

async function placeProduct(photo: Blob, scene: string): Promise<Blob> {
  const result = await client.images.edit({
    model: "grok-imagine-image-2.0",
    image: photo,
    prompt: `Place the product from this photo in a new setting: ${scene} Keep the product's shape, colors, and details exactly as they are. Commercial product photography, vertical frame.`,
    aspect_ratio: "9:16",
    response_format: "b64_json",
  });
  mediaCost += result.usage?.cost_usd ?? 0;
  const b64 = result.data[0]?.b64_json;
  if (!b64) throw new Error("The image response had no image data");
  return new Blob([Buffer.from(b64, "base64")], { type: "image/jpeg" });
}

async function pickBest(photo: Blob, scenes: Blob[], brief: Brief): Promise<Pick> {
  const response = await client.responses.create({
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
  });
  const pick = response.toJson() as Pick;
  return { ...pick, best: Math.min(Math.max(pick.best, 1), scenes.length) };
}

async function animate(image: Blob, motion: string, path: string): Promise<void> {
  const { request_id } = await client.videos.generate({
    model: "grok-imagine-video-1.5",
    prompt: motion,
    image,
    duration: 8,
    resolution: "720p",
  });
  const result = await client.videos.wait(request_id);
  if (result.status !== "done" || !result.video?.url) {
    throw new Error(`The video failed to render: ${result.status} ${result.error?.message ?? ""}`);
  }
  mediaCost += result.usage?.cost_usd ?? 0;
  const video = await fetch(result.video.url);
  await writeFile(path, Buffer.from(await video.arrayBuffer()));
}

async function narrate(text: string, path: string): Promise<void> {
  // The model writes the voiceover, so the SDK can't check it for speech tags at compile time.
  const speech = await client.voice.speak({ text: text as UnsafeSpeechText, language: "en", voice_id: VOICE });
  await writeFile(path, await speech.bytes());
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

function adPage(brief: Brief, pick: Pick, hasFinalCut: boolean): string {
  const scenes = brief.scenes
    .map(
      (scene, index) => `
      <figure class="${index + 1 === pick.best ? "picked" : ""}">
        <img src="scene-${index + 1}.jpg" alt="">
        <figcaption>${index + 1 === pick.best ? "<strong>Picked.</strong> " : ""}${escape(scene)}</figcaption>
      </figure>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escape(brief.product)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px auto; max-width: 1000px; padding: 0 20px; background: #111; color: #eee; }
  .top { display: flex; gap: 32px; align-items: flex-start; }
  video { height: 640px; border-radius: 12px; background: #000; }
  .scenes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 32px; }
  figure { margin: 0; opacity: 0.6; }
  figure.picked { opacity: 1; }
  img { width: 100%; border-radius: 8px; }
  figcaption, p { color: #aaa; font-size: 14px; }
</style>
<h1>${escape(brief.tagline)}</h1>
<div class="top">
  <video src="${hasFinalCut ? "final.mp4" : "ad.mp4"}" controls></video>
  <div>
    <p><strong>Voiceover:</strong> ${escape(brief.voiceover)}</p>
    <p><strong>Why scene ${pick.best}:</strong> ${escape(pick.reason)}</p>
  </div>
</div>
<div class="scenes">${scenes}</div>
</html>
`;
}

async function bytes(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
}
