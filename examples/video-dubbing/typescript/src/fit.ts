import { APIConnectionError, type SpeechWithTimestamps, SpaceXAI } from "@xai-official/sdk";
import type { Line } from "./dub.ts";

// A dub sends a burst of requests, so a rate limit is retried a few more times than the SDK's default of two,
// with a longer wait each time, and a Grok request that fails before Grok writes anything is sent again.
export const client = new SpaceXAI({ maxRetries: 5, retryBeforeOutput: true });

// Speech is priced by the character (https://docs.x.ai/developers/pricing). The voice API doesn't report
// what a request cost, so it's worked out from the text.
const SPEECH_USD_PER_CHARACTER = 15 / 1_000_000;
// A line that runs less than 5% over its slot is recorded a little faster instead of being rewritten. Past
// that, Grok shortens it, up to MAX_SHORTENINGS times, and whatever is still over is made up by speed, up to
// MAX_SPEED. Recordings vary a little in length, so the speed gets a small margin.
const SPEED_UP_BELOW = 1.05;
const MAX_SHORTENINGS = 2;
const MAX_SPEED = 1.15;
const SPEED_MARGIN = 0.05;
// A pause is timed on the space or punctuation it follows, so the speech in a recording runs from the first
// letter or digit to the last one.
const LETTER = /[\p{L}\p{N}]/u;

type Timestamps = NonNullable<SpeechWithTimestamps["audio_timestamps"]>;

// One recording of a line. Times are in seconds from the start of the recording.
export type Take = {
  text: string;
  speed: number;
  audio: Uint8Array;
  // When the speech starts and how long it lasts, leaving out the silence around it.
  start: number;
  length: number;
  // Each word with the time it starts, for highlighting it as it's spoken.
  words: Array<{ text: string; start: number }>;
  timestamps: Timestamps;
  cost: number;
};
// What happens after a take: it's shortened and recorded again, recorded faster, or it fits.
export type Next = "shorten" | "speed up" | "done";
export type Fit = { take: Take; takes: Take[]; shortenings: number; cost: number };

const SHORTEN_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

// Records a line and checks the recording against the line's slot, until it fits.
export async function fitLine(
  line: Line,
  text: string,
  voice: string,
  language: string,
  onTake: (take: Take, next: Next) => void = () => {},
  signal?: AbortSignal,
): Promise<Fit> {
  let take = await recordLine(text, voice, language, 1, signal);
  const takes = [take];
  let shortenings = 0;
  let cost = 0;
  while (take.length > line.slot * SPEED_UP_BELOW && shortenings < MAX_SHORTENINGS) {
    onTake(take, "shorten");
    const shorter = await shortenLine(line, take, language, signal);
    shortenings++;
    cost += shorter.cost;
    take = await recordLine(shorter.text, voice, language, 1, signal);
    takes.push(take);
  }
  if (take.length > line.slot) {
    onTake(take, "speed up");
    const speed = Math.min(MAX_SPEED, round(take.length / line.slot + SPEED_MARGIN));
    take = await recordLine(take.text, voice, language, speed, signal);
    takes.push(take);
  }
  // Every take after the first is meant to be shorter, but a recording can come out longer than the one before
  // it, even when it's faster, so the shortest is the one kept.
  const best = takes.reduce((shortest, each) => (each.length < shortest.length ? each : shortest));
  onTake(best, "done");
  return { take: best, takes, shortenings, cost };
}

async function recordLine(text: string, voice: string, language: string, speed: number, signal?: AbortSignal): Promise<Take> {
  const speech = await speak(text, voice, language, speed, signal);
  const timestamps = speech.audio_timestamps;
  if (!timestamps) throw new Error("The speech response had no timestamps");
  const spoken = timestamps.graph_chars.flatMap((char, index) => (LETTER.test(char) ? [index] : []));
  const first = spoken[0];
  const last = spoken.at(-1);
  const start = first === undefined ? 0 : timestamps.graph_times[first][0];
  const end = last === undefined ? speech.duration : timestamps.graph_times[last][1];
  return {
    text,
    speed,
    audio: Buffer.from(speech.audio, "base64"),
    start,
    length: end - start,
    words: toWords(timestamps),
    timestamps,
    cost: text.length * SPEECH_USD_PER_CHARACTER,
  };
}

// The SDK doesn't resend a request that creates something when the connection drops before the API answers,
// since sending it twice isn't always safe. Recording a line again is, so it gets two more tries.
async function speak(text: string, voice: string, language: string, speed: number, signal?: AbortSignal, tries = 3): Promise<SpeechWithTimestamps> {
  try {
    return await client.voice.speak({ text, language, voice_id: voice, speed, with_timestamps: true }, { signal });
  } catch (error) {
    if (!(error instanceof APIConnectionError) || tries === 1) throw error;
    return speak(text, voice, language, speed, signal, tries - 1);
  }
}

async function shortenLine(line: Line, take: Take, language: string, signal?: AbortSignal): Promise<{ text: string; cost: number }> {
  // The character timings show how much of the line had been said when the slot ran out. Grok is asked to
  // cut the rest, and a little more, as a share of the line.
  const { graph_chars, graph_times } = take.timestamps;
  const letters = graph_times.filter((_, index) => LETTER.test(graph_chars[index]));
  const said = letters.filter(([, end]) => end <= take.start + line.slot).length;
  const percent = Math.round((1 - said / letters.length) * 100) + 5;
  const name = languageName(language);
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      // At low effort a rewrite takes a few seconds. Asked for an exact character count, Grok spends most of
      // them counting letters, so it gets a share to cut instead.
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: `You shorten one line of a ${name} dub that ran long when it was recorded. Make it about shorter_by_percent shorter, and no shorter than that: keep as much of the meaning as fits. Keep the tone, and make it sound natural said out loud in ${name}. The original line is there for its meaning. Don't count characters: the new line is recorded and measured again. Write only the words to be spoken.`,
        },
        {
          role: "user",
          content: JSON.stringify({ original: line.text, translation: take.text, shorter_by_percent: percent }),
        },
      ],
      text: { format: { type: "json_schema", name: "shorter_line", schema: SHORTEN_SCHEMA } },
    },
    { signal },
  );
  const { text } = response.toJson() as { text: string };
  return { text, cost: response.usage.cost_usd ?? 0 };
}

// Groups the timed characters into words, each starting at its first character. Chinese and Japanese don't
// put spaces between words, so their punctuation ends a word too.
function toWords({ graph_chars, graph_times }: Timestamps): Take["words"] {
  const words: Take["words"] = [];
  graph_chars.forEach((char, index) => {
    const word = words.at(-1);
    if (!word || /[\s、。，！？]$/.test(word.text)) words.push({ text: char, start: graph_times[index][0] });
    else word.text += char;
  });
  return words;
}

export function languageName(code: string): string {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

export function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
