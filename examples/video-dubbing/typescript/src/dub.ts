import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { promisify } from "node:util";
import type { Transcription } from "@xai-official/sdk";
import { type Fit, type Next, type Take, client, fitLine, languageName, round } from "./fit.ts";

const run = promisify(execFile);

export const DEFAULT_LANGUAGE = "es-MX";
// Built-in voices for the dub, given to the speakers in the order they first speak. Keeping each speaker's
// own voice takes a custom voice, and creating those through the API takes an Enterprise plan.
export const VOICES = [
  { id: "leo", gender: "man" },
  { id: "ara", gender: "woman" },
  { id: "sal", gender: "man" },
  { id: "luna", gender: "woman" },
] as const;

// The voice API doesn't report what a request cost, so it's worked out from the price per hour.
const TRANSCRIPTION_USD_PER_SECOND = 0.1 / 3600;
// A new line starts when the speaker changes, after a sentence ends, or after a pause this long.
const PAUSE = 0.8;
// A dub line can run this far past the end of the original line, as long as it stops GAP before the next.
const OVERHANG = 0.3;
const GAP = 0.1;
// About how many characters the built-in voices say in a second. Chinese, Japanese, and Korean pack a
// syllable or more into each character.
const CHARS_PER_SECOND: Record<string, number> = { zh: 6, ja: 6.5, ko: 7.5 };
const DEFAULT_CHARS_PER_SECOND = 17;
// A very short line gets the budget of a MIN_BUDGET-second one. Squeezed into fewer characters, Grok tends to
// drop words the line needs, and a line that runs long is shortened after it's recorded anyway.
const MIN_BUDGET = 1.2;
// The original sound is turned down to this, so its background carries on under the dub.
const ORIGINAL_VOLUME = 0.25;

export type Word = { text: string; start: number; end: number };
// A line of the original and the slot its dub has to fit in: it starts at `start` and lasts `slot` seconds.
export type Line = { id: number; speaker: number; start: number; end: number; slot: number; text: string; words: Word[] };
export type Transcript = { language: string; duration: number; lines: Line[]; voices: string[] };
export type Step = "transcribe" | "translate" | "record" | "mix";
export type Cost = { transcription: number; translation: number; speech: number };
export type Dub = { dir: string; video: string; lines: Line[]; fits: Fit[]; cost: Cost };

export type DubEvents = {
  step?: (step: Step, status: "active" | "done") => void;
  transcript?: (transcript: Transcript) => void;
  reasoning?: (text: string) => void;
  // Called as Grok writes each line, with `done` once the line is complete.
  translation?: (line: Line, text: string, done: boolean) => void;
  take?: (line: Line, take: Take, next: Next) => void;
};

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["lines"],
  additionalProperties: false,
};

// Dubs the video and saves everything to output/<video>-<language>/, reporting each step as it starts and
// each result as soon as it's ready.
export async function dubVideo(video: string, language: string, on: DubEvents = {}, signal?: AbortSignal): Promise<Dub> {
  const dir = `output/${slugify(basename(video, extname(video)))}-${language.toLowerCase()}`;
  await mkdir(dir, { recursive: true });

  on.step?.("transcribe", "active");
  const transcription = await transcribe(await extractAudio(video, dir, signal), signal);
  const lines = splitLines(transcription);
  if (!lines.length) throw new Error("There's no speech in the video to dub.");
  const speakers = Math.max(...lines.map((line) => line.speaker)) + 1;
  const voices = Array.from({ length: speakers }, (_, speaker) => voiceFor(speaker).id);
  on.transcript?.({ language: transcription.language, duration: transcription.duration, lines, voices });
  on.step?.("transcribe", "done");

  // Each line is recorded as soon as Grok has translated it, six at a time, while Grok writes the rest.
  on.step?.("translate", "active");
  const record = limit(6);
  const fits: Array<Promise<Fit>> = [];
  const translation = await translateLines(
    lines,
    language,
    {
      reasoning: on.reasoning,
      draft: (line, text) => on.translation?.(line, text, false),
      line: (line, text) => {
        on.translation?.(line, text, true);
        if (!fits.length) on.step?.("record", "active");
        const fit = record(() =>
          fitLine(line, text, voiceFor(line.speaker).id, language, (take, next) => on.take?.(line, take, next), signal),
        );
        // It's awaited with the others below, so a failure before then isn't an unhandled rejection.
        fit.catch(() => {});
        fits[line.id - 1] = fit;
      },
    },
    signal,
  );
  on.step?.("translate", "done");
  const fitted = await Promise.all(fits);
  on.step?.("record", "done");

  on.step?.("mix", "active");
  const files = lines.map((line) => `${dir}/line-${String(line.id).padStart(2, "0")}.mp3`);
  await Promise.all(fitted.map((fit, index) => writeFile(files[index], fit.take.audio)));
  const dubbed = `${dir}/dubbed.mp4`;
  await mixDub(video, lines, fitted, files, dubbed, signal);
  await writeFile(`${dir}/script.json`, JSON.stringify(script(lines, fitted), null, 2));
  on.step?.("mix", "done");

  const cost: Cost = {
    transcription: transcription.duration * TRANSCRIPTION_USD_PER_SECOND,
    translation: fitted.reduce((sum, fit) => sum + fit.cost, translation.cost),
    speech: fitted.flatMap((fit) => fit.takes).reduce((sum, take) => sum + take.cost, 0),
  };
  return { dir, video: dubbed, lines, fits: fitted, cost };
}

// The transcription model works at 16 kHz, so a mono FLAC at that rate has everything it needs from the video
// in a fraction of the size.
async function extractAudio(video: string, dir: string, signal?: AbortSignal): Promise<string> {
  const audio = `${dir}/audio.flac`;
  await ffmpeg(["-i", video, "-vn", "-ac", "1", "-ar", "16000", audio], signal);
  return audio;
}

async function transcribe(audio: string, signal?: AbortSignal): Promise<Transcription> {
  // With diarize, the API reads the audio's format from its file name, so it's sent as a named File.
  const file = new File([await readFile(audio)], basename(audio));
  return client.voice.transcribe({ file, model: "grok-voice-transcribe-2.0", diarize: true }, { signal });
}

// Groups the timed words into lines, and gives each line a slot that ends shortly before the next line starts.
export function splitLines({ words = [], duration }: Transcription): Line[] {
  // Diarization numbers the speakers, and the lines number them in the order they first speak.
  const order: number[] = [];
  const lines: Line[] = [];
  for (const { text, start, end, speaker: id = 0 } of words) {
    if (!order.includes(id)) order.push(id);
    const speaker = order.indexOf(id);
    const line = lines.at(-1);
    const previous = line?.words.at(-1);
    if (!line || !previous || line.speaker !== speaker || /[.!?…。！？]["'”’)]*$/.test(previous.text) || start - previous.end > PAUSE) {
      lines.push({ id: lines.length + 1, speaker, start, end, slot: 0, text: "", words: [{ text, start, end }] });
    } else {
      line.words.push({ text, start, end });
      line.end = end;
    }
  }
  lines.forEach((line, index) => {
    const next = lines[index + 1]?.start ?? duration;
    line.text = line.words.map((word) => word.text).join(" ");
    line.slot = round(Math.max(line.end, Math.min(line.end + OVERHANG, next - GAP)) - line.start);
  });
  return lines;
}

// Streams the translation and reports each line as soon as it's complete, so callers can record it while
// Grok writes the rest.
async function translateLines(
  lines: Line[],
  language: string,
  on: { reasoning?: (text: string) => void; draft?: (line: Line, text: string) => void; line?: (line: Line, text: string) => void },
  signal?: AbortSignal,
): Promise<{ cost: number }> {
  const name = languageName(language);
  const rate = CHARS_PER_SECOND[language.split("-")[0]] ?? DEFAULT_CHARS_PER_SECOND;
  const speakers = [...new Set(lines.map((line) => line.speaker))]
    .map((speaker) => `Speaker ${speaker + 1} is voiced by a ${voiceFor(speaker).gender}.`)
    .join(" ");
  const script = lines.map((line) => ({
    id: line.id,
    speaker: line.speaker + 1,
    seconds: line.slot,
    max_characters: Math.floor(Math.max(line.slot, MIN_BUDGET) * rate),
    text: line.text,
  }));
  const texts = new Map<number, string>();
  const find = (item?: { id?: number }) => lines.find((line) => line.id === item?.id && !texts.has(line.id));
  const finish = (item?: { id?: number; text?: string }) => {
    const line = find(item);
    if (!line || item?.text === undefined) return;
    texts.set(line.id, item.text);
    on.line?.(line, item.text);
  };

  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "system",
          content: `You translate the dialogue of a video into ${name} for a dub. Each line you write is recorded and played over the original line, in the same time slot, so it has to fit.
- Translate every line, in order, and keep its id. Keep names, terms, and the way the speakers address each other consistent from line to line.
- Keep each line to about its max_characters, counting spaces and punctuation. That's roughly what a voice can say in the line's seconds. When a faithful translation is longer, say it more briefly, dropping filler and repetition before meaning, but always write a complete line that a native speaker would say.
- Estimate lengths instead of counting characters one by one. Each line is recorded and measured, and any line that runs long comes back to be shortened.
- Write the way people talk in ${name}, in the tone of the original, casual or formal.
- Each speaker is voiced by the person described, so when a line refers to its speaker, use the grammatical gender that matches.
- Write only the words to be spoken: no notes, stage directions, or speech tags.`,
        },
        { role: "user", content: `${speakers}\n\n${JSON.stringify(script)}` },
      ],
      text: { format: { type: "json_schema", name: "dub_script", schema: TRANSLATION_SCHEMA } },
      // At the default effort, Grok works out the length of every line before it writes any of them, which for
      // the sample took over 12,000 reasoning tokens and six minutes. Low effort uses a few hundred, and the
      // first line usually arrives within ten seconds.
      reasoning: { effort: "low" },
      stream: true,
    },
    { signal },
  );
  let finished = 0;
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    // The script so far, with the line that's still being written closed off. Every line before it is finished.
    .on("json", (value) => {
      const written = (value as { lines?: Array<{ id?: number; text?: string }> }).lines ?? [];
      for (; finished < written.length - 1; finished++) finish(written[finished]);
      const draft = written.at(-1);
      const line = find(draft);
      if (line && draft?.text) on.draft?.(line, draft.text);
    })
    .done();
  const translated = (response.toJson() as { lines: Array<{ id: number; text: string }> }).lines;
  translated.slice(finished).forEach(finish);
  const missing = lines.find((line) => !texts.has(line.id));
  if (missing) throw new Error(`Grok didn't translate line ${missing.id}.`);
  return { cost: response.usage.cost_usd ?? 0 };
}

// Turns the original sound down and lays each line's recording where the original line starts.
async function mixDub(video: string, lines: Line[], fits: Fit[], files: string[], out: string, signal?: AbortSignal): Promise<void> {
  const placed = lines.map((line, index) => {
    // A recording starts with a moment of silence, so it goes in that much earlier, and its first word
    // lands where the original's first word did.
    const delay = Math.max(0, Math.round((line.start - fits[index].take.start) * 1000));
    return `[${index + 1}:a]adelay=${delay}:all=1[line${index}]`;
  });
  const mix = `[original]${lines.map((_, index) => `[line${index}]`).join("")}amix=inputs=${lines.length + 1}:duration=first:normalize=0[dub]`;
  await ffmpeg(
    [
      "-i", video,
      ...files.flatMap((file) => ["-i", file]),
      "-filter_complex", [`[0:a]volume=${ORIGINAL_VOLUME}[original]`, ...placed, mix].join(";"),
      "-map", "0:v:0", "-map", "[dub]", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", out,
    ],
    signal,
  );
}

function script(lines: Line[], fits: Fit[]) {
  return lines.map((line, index) => ({
    ...line,
    voice: voiceFor(line.speaker).id,
    takes: fits[index].takes.map(({ text, speed, start, length }) => ({ text, speed, start: round(start), length: round(length) })),
  }));
}

export function voiceFor(speaker: number): (typeof VOICES)[number] {
  return VOICES[speaker % VOICES.length];
}

async function ffmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  await run("ffmpeg", ["-y", "-v", "error", ...args], { signal });
}

// Runs at most `concurrency` tasks at a time, in the order they're added.
function limit(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
}

export { languageName };
