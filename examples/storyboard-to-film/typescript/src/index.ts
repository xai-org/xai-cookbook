import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_PREMISE,
  type Storyboard,
  animate,
  assembleFilm,
  drawKeyframes,
  narrate,
  planStoryboard,
  slugify,
} from "./storyboard.ts";

const premise = process.argv.slice(2).join(" ") || DEFAULT_PREMISE;
console.log(`Premise: ${premise}`);

const board = await planStoryboard(premise);
const dir = `output/${slugify(board.title)}`;
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/storyboard.json`, JSON.stringify(board, null, 2));
console.log(`\n"${board.title}"\n${board.style}`);
board.shots.forEach((shot, index) => console.log(`  ${index + 1}. ${shot.scene}`));

console.log("\nDrawing keyframes");
const keyframes = await drawKeyframes(board);
await Promise.all(keyframes.map((frame, index) => writeFile(`${dir}/keyframe-${index + 1}.jpg`, frame.bytes)));
let cost = keyframes.reduce((sum, frame) => sum + frame.cost, 0);

console.log("Animating the shots and recording narration. Video takes a few minutes.");
await Promise.all([
  ...board.shots.map(async (shot, index) => {
    const video = await animate(shot, keyframes[index]);
    cost += video.cost;
    await writeFile(`${dir}/shot-${index + 1}.mp4`, video.bytes);
  }),
  ...board.shots.map(async (shot, index) => writeFile(`${dir}/narration-${index + 1}.mp3`, await narrate(shot.narration))),
]);

const hasFilm = await assembleFilm(dir, board.shots.length);
await writeFile(`${dir}/index.html`, storyboardPage(board, hasFilm));

console.log(`\nSaved ${dir}/index.html${hasFilm ? ` and ${dir}/film.mp4` : ". Install ffmpeg to also get the shots joined into film.mp4."}`);
console.log(`Image and video cost: $${cost.toFixed(2)}`);

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

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
