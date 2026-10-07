import { openAsBlob } from "node:fs";
import { listVoices, makeScene } from "./scene.ts";

const SAMPLE = [
  ["sample-dog.jpg", "rex", "Hi! I'm a drawing, and I can talk now! Do you want to be best friends?"],
  ["sample-cat.jpg", "luna", "I'm a cat. We'll see."],
];
const USAGE = `Usage: npm start -- <picture> <voice> "<line>" [<picture> <voice> "<line>"]
       npm start -- voices`;

const args = process.argv.slice(2);
if (args[0] === "voices") {
  for (const voice of await listVoices()) console.log(`${voice.voice_id.padEnd(9)}${voice.name}`);
  process.exit();
}
if (args.length % 3 !== 0 || args.length > 9) {
  console.error(USAGE);
  process.exit(1);
}

const groups = args.length ? Array.from({ length: args.length / 3 }, (_, index) => args.slice(index * 3, index * 3 + 3)) : SAMPLE;
const cast = await Promise.all(groups.map(async ([path, voice, line]) => ({ image: await openAsBlob(path), voice, line })));
groups.forEach(([path, voice, line]) => console.log(`${path} (${voice}): "${line}"`));

let shown = -1;
const scene = await makeScene(cast, {
  started: (prompt, seconds) => console.log(`\n${prompt}\n\nRendering ${seconds} seconds of video. It takes a minute or two.`),
  progress: (percent) => {
    if (percent !== shown) process.stdout.write(`\r${(shown = percent)}% done`);
  },
});
console.log(`\nSaved ${scene.dir}/scene.mp4`);
console.log(`Video cost: $${scene.cost.toFixed(2)}`);
