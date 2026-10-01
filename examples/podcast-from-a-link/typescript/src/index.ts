import { mkdir, writeFile } from "node:fs/promises";
import { HOSTS, type Script, limit, readSource, recordLine, writeScript } from "./podcast.ts";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm start -- <url or path to a PDF>");
  process.exit(1);
}

console.log(`Reading ${source}`);
const material = await readSource(source);

console.log("Writing the script, and recording each line as soon as it's written");
const record = limit(4);
const clips: Array<Promise<Uint8Array>> = [];
let recorded = 0;
const script = await writeScript(material, {
  line: (line, index) => {
    clips[index] = record(async () => {
      const clip = await recordLine(line);
      process.stdout.write(`\rRecorded ${++recorded} lines`);
      return clip;
    });
  },
});
// MP3 frames can be joined end to end, so the clips play back as one file.
const audio = Buffer.concat(await Promise.all(clips));

const name = slugify(script.title);
await mkdir("output", { recursive: true });
await writeFile(`output/${name}.mp3`, audio);
await writeFile(`output/${name}.md`, transcript(script));
console.log(`\n"${script.title}", ${script.lines.length} lines. Saved output/${name}.mp3 and output/${name}.md`);

function transcript(script: Script): string {
  const lines = script.lines.map((line) => `**${HOSTS[line.speaker].name}:** ${line.text}`);
  return `# ${script.title}\n\n${lines.join("\n\n")}\n`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "episode";
}
