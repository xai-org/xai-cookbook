import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { type UnsafeSpeechText, xAI } from "@xai-official/sdk";

const client = new xAI();

const NARRATOR = "leo";
const SHOT_SECONDS = 8;

type Shot = { scene: string; motion: string; narration: string };
type Storyboard = { title: string; style: string; shots: Shot[] };

const STORYBOARD_PROMPT = `You're a director planning a short film of exactly four shots, ${SHOT_SECONDS} seconds each.
Follow one main subject through all four shots and tell a small story with a beginning, a turn, and an ending.

- title: a short title for the film.
- style: one sentence describing the look every shot shares: medium, color palette, and lighting.
- shots: exactly four, in order. For each one:
  - scene: what the frame shows, in one or two sentences. Describe the main subject the same way every time.
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

let mediaCost = 0;

const premise = process.argv.slice(2).join(" ") || "A paper boat's journey through a rainy city at night";
console.log(`Premise: ${premise}`);

const board = await planStoryboard(premise);
const dir = `output/${slugify(board.title)}`;
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/storyboard.json`, JSON.stringify(board, null, 2));
console.log(`\n"${board.title}"\n${board.style}`);
board.shots.forEach((shot, index) => console.log(`  ${index + 1}. ${shot.scene}`));

console.log("\nDrawing keyframes");
const keyframes = await drawKeyframes(board);
await Promise.all(keyframes.map(async (frame, index) => writeFile(`${dir}/keyframe-${index + 1}.jpg`, await bytes(frame))));

console.log("Animating the shots and recording narration. Video takes a few minutes.");
await Promise.all([
  ...board.shots.map((shot, index) => animate(shot, keyframes[index], `${dir}/shot-${index + 1}.mp4`)),
  ...board.shots.map((shot, index) => narrate(shot.narration, `${dir}/narration-${index + 1}.mp3`)),
]);

const hasFilm = assembleFilm(dir, board.shots.length);
await writeFile(`${dir}/index.html`, storyboardPage(board, hasFilm));

console.log(`\nSaved ${dir}/index.html${hasFilm ? ` and ${dir}/film.mp4` : ". Install ffmpeg to also get the shots joined into film.mp4."}`);
console.log(`Image and video cost: $${mediaCost.toFixed(2)}`);

async function planStoryboard(premise: string): Promise<Storyboard> {
  const response = await client.responses.create({
    model: "grok-4.7",
    input: [
      { role: "system", content: STORYBOARD_PROMPT },
      { role: "user", content: premise },
    ],
    text: { format: { type: "json_schema", name: "storyboard", schema: STORYBOARD_SCHEMA } },
  });
  const board = response.toJson() as Storyboard;
  return { ...board, shots: board.shots.slice(0, 4) };
}

async function drawKeyframes(board: Storyboard): Promise<Blob[]> {
  const [first, ...rest] = board.shots;
  const generated = await client.images.generate({
    model: "grok-imagine-image-2.0",
    prompt: `${board.style} ${first.scene}`,
    aspect_ratio: "16:9",
    response_format: "b64_json",
  });
  mediaCost += generated.usage?.cost_usd ?? 0;
  const firstFrame = toBlob(generated.data[0]?.b64_json);

  // The other keyframes are edits of the first one, which keeps the subject and style consistent across shots.
  const edited = await Promise.all(
    rest.map(async (shot) => {
      const result = await client.images.edit({
        model: "grok-imagine-image-2.0",
        image: firstFrame,
        prompt: `Keep the same main subject, art style, and color palette as this image. New scene: ${shot.scene}`,
        response_format: "b64_json",
      });
      mediaCost += result.usage?.cost_usd ?? 0;
      return toBlob(result.data[0]?.b64_json);
    }),
  );
  return [firstFrame, ...edited];
}

async function animate(shot: Shot, keyframe: Blob, path: string): Promise<void> {
  const { request_id } = await client.videos.generate({
    model: "grok-imagine-video-1.5",
    prompt: shot.motion,
    image: keyframe,
    duration: SHOT_SECONDS,
    resolution: "720p",
  });
  const result = await client.videos.wait(request_id);
  if (result.status !== "done" || !result.video?.url) {
    throw new Error(`A shot failed to render: ${result.status} ${result.error?.message ?? ""}`);
  }
  mediaCost += result.usage?.cost_usd ?? 0;
  const video = await fetch(result.video.url);
  if (!video.ok) throw new Error(`Couldn't download a shot: ${video.status}`);
  await writeFile(path, Buffer.from(await video.arrayBuffer()));
}

async function narrate(text: string, path: string): Promise<void> {
  // The model writes the narration, so the SDK can't check it for speech tags at compile time.
  const speech = await client.voice.speak({ text: text as UnsafeSpeechText, language: "en", voice_id: NARRATOR });
  await writeFile(path, await speech.bytes());
}

// Lays each narration over its shot, with the shot's own sound turned down, then joins the shots.
function assembleFilm(dir: string, count: number): boolean {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return false;
  const scenes: string[] = [];
  for (let index = 1; index <= count; index++) {
    const scene = `scene-${index}.mp4`;
    ffmpeg([
      "-i", `${dir}/shot-${index}.mp4`,
      "-i", `${dir}/narration-${index}.mp3`,
      "-filter_complex", "[0:a]volume=0.3[bg];[1:a]adelay=400:all=1[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]",
      "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", `${dir}/${scene}`,
    ]);
    scenes.push(`file '${scene}'`);
  }
  const list = `${dir}/scenes.txt`;
  writeFileSync(list, `${scenes.join("\n")}\n`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", `${dir}/film.mp4`]);
  return true;
}

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

function storyboardPage(board: Storyboard, hasFilm: boolean): string {
  const shots = board.shots
    .map(
      (shot, index) => `
      <figure>
        <video src="shot-${index + 1}.mp4" poster="keyframe-${index + 1}.jpg" controls></video>
        <figcaption><strong>${index + 1}.</strong> ${escape(shot.narration)}</figcaption>
        <audio src="narration-${index + 1}.mp3" controls></audio>
      </figure>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escape(board.title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px auto; max-width: 1100px; padding: 0 20px; background: #111; color: #eee; }
  video { width: 100%; border-radius: 8px; background: #000; }
  .shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  figure { margin: 0; }
  audio { width: 100%; margin-top: 4px; }
  p { color: #aaa; }
</style>
<h1>${escape(board.title)}</h1>
<p>${escape(board.style)}</p>
${hasFilm ? `<video src="film.mp4" controls></video>` : ""}
<div class="shots">${shots}</div>
</html>
`;
}

function toBlob(b64: string | null | undefined): Blob {
  if (!b64) throw new Error("The image response had no image data");
  return new Blob([Buffer.from(b64, "base64")], { type: "image/jpeg" });
}

async function bytes(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "film";
}
