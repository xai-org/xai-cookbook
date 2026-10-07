import { mkdir, writeFile } from "node:fs/promises";
import { type Article, COST_PER_CHARACTER, type Recording, VOICE, readArticle, recordAll } from "./readalong.ts";

const source = process.argv[2] ?? "sample-article.txt";

console.log(`Reading ${source}`);
const article = await readArticle(source);
const characters = article.paragraphs.join("").length;
console.log(`${article.title ? `"${article.title}": ` : ""}${article.paragraphs.length} paragraphs, ${characters.toLocaleString("en")} characters`);

console.log("\nRecording the paragraphs, a few at a time");
const started = Date.now();
const elapsed = () => (Date.now() - started) / 1000;
const recordings = await recordAll(article.paragraphs, {
  recorded: (index, recording) => {
    const opening = recording.words.slice(0, 6).map((word) => word.text).join(" ");
    console.log(`  ${index + 1}. ready after ${formatTime(elapsed())}, ${formatTime(recording.duration)} of audio: ${opening}…`);
  },
});

const dir = `output/${slugify(article.title || article.paragraphs[0].split(" ").slice(0, 6).join(" "))}`;
const timing = timings(article, recordings);
await mkdir(dir, { recursive: true });
// MP3 frames can be joined end to end, so the paragraphs play back as one file.
await writeFile(`${dir}/article.mp3`, Buffer.concat(recordings.map((recording) => recording.audio)));
await writeFile(`${dir}/timings.json`, JSON.stringify(timing, null, 2));
console.log(`\nRecorded ${formatTime(timing.duration)} of audio in ${formatTime(elapsed())}.`);
console.log(`Saved ${dir}/article.mp3, and when each word is spoken in ${dir}/timings.json`);
console.log(`Speech cost: $${(characters * COST_PER_CHARACTER).toFixed(2)}`);

// Times every word in the joined file. Each MP3 runs about 50 ms longer than the duration the API
// reports, which adds up over an article, but at the default 128 kbps an MP3 is 16,000 bytes a second,
// so its size gives its exact length.
function timings(article: Article, recordings: Recording[]) {
  let offset = 0;
  const paragraphs = recordings.map((recording, index) => {
    const start = offset;
    offset += recording.audio.length / 16_000;
    const words = recording.words.map((word) => ({ text: word.text, start: round(start + word.start), end: round(start + word.end) }));
    return { text: article.paragraphs[index], start: round(start), end: round(offset), words };
  });
  return { title: article.title, voice: VOICE, duration: round(offset), paragraphs };
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "article";
}
