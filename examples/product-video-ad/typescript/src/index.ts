import { openAsBlob } from "node:fs";
import { writeFile } from "node:fs/promises";
import { type Brief, type Pick, makeAd } from "./ad.ts";

const STEPS = {
  brief: "Writing the brief",
  scenes: "\nPlacing the product in each scene",
  pick: "Picking the strongest scene",
  video: "Animating it and recording the voiceover. Video takes a minute or two.",
};

const photoPath = process.argv[2] ?? "sample-product.jpg";
const description = process.argv.slice(3).join(" ") || (process.argv[2] ? "The product in the photo" : "A ceramic travel mug with a bamboo lid that keeps coffee hot for hours");

const ad = await makeAd(await openAsBlob(photoPath), description, {
  step: (step) => console.log(STEPS[step]),
  brief: (brief) => {
    console.log(`${brief.product}: "${brief.tagline}"`);
    brief.scenes.forEach((scene, index) => console.log(`  ${index + 1}. ${scene}`));
  },
  pick: (pick) => console.log(`  Scene ${pick.best}: ${pick.reason}`),
});

await writeFile(`${ad.dir}/index.html`, adPage(ad.brief, ad.pick, ad.finalCut));
console.log(`\nSaved ${ad.dir}/index.html${ad.finalCut ? ` and ${ad.dir}/final.mp4` : ". Install ffmpeg to also get the ad with the voiceover in final.mp4."}`);
console.log(`Image and video cost: $${ad.cost.toFixed(2)}`);

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

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
