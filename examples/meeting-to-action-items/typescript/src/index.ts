import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { styleText } from "node:util";
import { SAMPLE_PATH, readAudio, recordSampleMeeting, streamAudio } from "./audio.ts";
import { startMeeting } from "./meeting.ts";
import { type Item, clock, notesMarkdown } from "./notes.ts";

const path = process.argv[2] ?? SAMPLE_PATH;
if (!process.argv[2]) {
  const cost = await recordSampleMeeting();
  if (cost) console.log(`Recorded the sample meeting with text to speech for $${cost.toFixed(3)}`);
}
const { pcm, sampleRate } = await readAudio(path);
console.log(styleText("bold", `Streaming ${path} as it plays, ${clock(pcm.length / 2 / sampleRate)} of audio\n`));

const names = new Map<number, string>();
const name = (speaker: number) => names.get(speaker) ?? `Speaker ${speaker}`;
const meeting = await startMeeting(sampleRate, {
  interim: (text) => showInterim(text),
  line: (line, open) => {
    if (open) return;
    showInterim("");
    console.log(`${styleText("bold", name(line.speaker))} ${styleText("dim", clock(line.start))}  ${line.text}`);
  },
  change: (list, item, previous) => {
    showInterim("");
    const kind = list === "decisions" ? "decision" : "action item";
    console.log(styleText(previous ? "yellow" : "green", `  ${previous ? "Changed" : "New"} ${kind}: ${describe(item)}`));
  },
  speakers: (speakers) => {
    showInterim("");
    for (const { speaker, name } of speakers.filter((known) => names.get(known.speaker) !== known.name)) {
      console.log(styleText("dim", `  Speaker ${speaker} is ${name}`));
      names.set(speaker, name);
    }
  },
  error: (error) => console.error(styleText("red", `  Couldn't revise the notes: ${error.message}`)),
});
await streamAudio(pcm, sampleRate, meeting.send);
showInterim("");
console.log(styleText("dim", "\nThat's the end of the audio. Finishing the notes."));
await meeting.finish();

const { summary, decisions, action_items } = meeting.notes;
console.log(`\n${styleText("bold", "Summary")}\n${summary}`);
if (decisions.length) console.log(`\n${styleText("bold", "Decisions")}\n${decisions.map((item) => `  ${describe(item)}`).join("\n")}`);
if (action_items.length) console.log(`\n${styleText("bold", "Action items")}\n${action_items.map((item) => `  ${describe(item)}`).join("\n")}`);

const saved = `output/${basename(path, extname(path))}-notes.md`;
await mkdir("output", { recursive: true });
await writeFile(saved, notesMarkdown(`Notes on ${basename(path)}`, meeting.notes, meeting.lines));
const { transcription, notes } = meeting.cost;
console.log(`\nSaved ${saved}`);
console.log(`Cost: $${(transcription + notes).toFixed(3)}, of which $${transcription.toFixed(4)} for transcription and $${notes.toFixed(3)} for the notes`);

// Shows the interim text on a line of its own, rewritten as it changes, when the output is a terminal.
function showInterim(text: string): void {
  if (!process.stdout.isTTY) return;
  const width = process.stdout.columns - 1;
  process.stdout.write(`\r\x1b[2K${styleText("dim", text.length > width ? `…${text.slice(1 - width)}` : text)}`);
}

function describe(item: Item): string {
  return "task" in item ? [item.task, item.owner, item.due].filter(Boolean).join(" · ") : item.text;
}
