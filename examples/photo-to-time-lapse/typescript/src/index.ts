import { openAsBlob } from "node:fs";
import { writeFile } from "node:fs/promises";
import { type Plan, SECONDS, describeChange, formatMark, makeTimeLapse } from "./timelapse.ts";

const STEPS = {
  plan: "Planning the stages",
  stills: "\nEditing the photo for each stage",
  video: "Rendering the time-lapse. Video takes a minute or two.",
};

const photoPath = process.argv[2] ?? "sample-street.jpg";
const request = describeChange(process.argv.slice(3).join(" ") || "seasons");
console.log(request);

let shown = -1;
const lapse = await makeTimeLapse(await openAsBlob(photoPath), request, {
  step: (step) => console.log(STEPS[step]),
  plan: (plan) => {
    console.log(`"${plan.title}"`);
    plan.stages.forEach((stage) => console.log(`  ${formatMark(stage.at).padEnd(5)} ${stage.label}: ${stage.edit}`));
  },
  still: (index, path) => console.log(`  Saved ${path}`),
  progress: (percent) => {
    if (percent !== shown) process.stdout.write(`${shown < 0 ? " " : ""} ${percent}%`);
    shown = percent;
  },
});

await writeFile(`${lapse.dir}/index.html`, timeLapsePage(lapse.plan));
console.log(`\n\nSaved ${lapse.dir}/time-lapse.mp4 and ${lapse.dir}/index.html`);
console.log(`Image and video cost: $${lapse.cost.toFixed(2)}`);

// Shows the video with each stage's still under it, at its mark on the timeline.
function timeLapsePage(plan: Plan): string {
  const pins = plan.stages
    .map((stage, index) => {
      const left = (stage.at / SECONDS) * 100;
      return `
      <figure style="left: ${left}%; transform: translateX(-${left}%)" title="${escape(stage.edit)}">
        <img src="stage-${index + 1}.jpg" alt="">
        <figcaption><strong>${escape(stage.label)}</strong> ${formatMark(stage.at)}</figcaption>
      </figure>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escape(plan.title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 40px auto; max-width: 1100px; padding: 0 20px; background: #111; color: #eee; }
  video { width: 100%; border-radius: 12px; background: #000; }
  .pins { position: relative; height: 150px; margin-top: 12px; border-top: 1px solid #333; }
  figure { position: absolute; top: 12px; width: 16%; margin: 0; }
  img { width: 100%; border-radius: 6px; }
  figcaption { font-size: 13px; color: #aaa; }
  figcaption strong { color: #eee; font-weight: 500; }
</style>
<h1>${escape(plan.title)}</h1>
<video src="time-lapse.mp4" controls autoplay muted loop></video>
<div class="pins">${pins}</div>
</html>
`;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
