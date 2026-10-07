import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { SpaceXAI, stripInvalidSpeechTags } from "@xai-official/sdk";

const client = new SpaceXAI();

export const VOICE = "eve";
export const COST_PER_CHARACTER = 15 / 1_000_000;
// About 20 minutes of audio, for 30 cents. A longer article stops at the paragraph that would go past it.
const MAX_CHARACTERS = 20_000;
// A paragraph records several times faster than it plays, so a few at a time stays well ahead of the
// listener.
const AT_ONCE = 4;

export type Article = { title: string; paragraphs: string[] };
export type Word = { text: string; start: number; end: number };
export type Recording = { audio: Uint8Array; duration: number; words: Word[] };

export type RecordEvents = {
  recording?: (index: number) => void;
  recorded?: (index: number, recording: Recording) => void;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", ldquo: "“", rdquo: "”", mdash: "—" };

// Reads an article from a link, or from a web page or a text file on disk.
export async function readArticle(source: string, signal?: AbortSignal): Promise<Article> {
  if (existsSync(source)) {
    const text = await readFile(source, "utf8");
    return /<p[\s>]/i.test(text) ? fromHtml(text) : fromText(text);
  }
  const response = await fetch(source, { headers: { "user-agent": "Mozilla/5.0 (SpaceXAI cookbook)" }, signal });
  if (!response.ok) throw new Error(`Couldn't fetch ${source}: ${response.status}`);
  return fromHtml(await response.text());
}

// Keeps the page's title and the text of its paragraphs, which leaves out menus, captions, and most
// other clutter.
export function fromHtml(html: string): Article {
  // Superscripts hold footnote markers like [1], which shouldn't be read aloud.
  const page = html.replace(/<(script|style|noscript|svg|nav|footer|aside|figure|sup)\b[\s\S]*?<\/\1>/gi, " ");
  const main = page.match(/<article\b[\s\S]*<\/article>/i)?.[0] ?? page.match(/<main\b[\s\S]*<\/main>/i)?.[0] ?? page;
  const title = (main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? page.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i))?.[1] ?? "";
  const paragraphs = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => htmlToText(match[1]));
  return toArticle(htmlToText(title), paragraphs.filter((text) => text.split(" ").length >= 6));
}

// Splits pasted text into paragraphs. A short first line that doesn't end like a sentence is the title.
export function fromText(text: string): Article {
  // Hard-wrapped text breaks lines inside paragraphs, and then only a blank line ends one.
  const breaks = /\n\s*\n/.test(text) ? /\n\s*\n/ : /\n/;
  const paragraphs = text.split(breaks).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
  const titled = paragraphs.length > 1 && paragraphs[0].length <= 120 && !/[.!?:]["”’)]?$/.test(paragraphs[0]);
  return toArticle(titled ? paragraphs[0] : "", titled ? paragraphs.slice(1) : paragraphs);
}

// Records a paragraph and works out when each of its words is spoken.
export async function recordParagraph(text: string, signal?: AbortSignal): Promise<Recording> {
  const speech = await client.voice.speak({ text, language: "en", voice_id: VOICE, with_timestamps: true }, { signal });
  if (!speech.audio_timestamps) throw new Error("The speech response had no timestamps");
  const { graph_chars, graph_times } = speech.audio_timestamps;
  return { audio: Buffer.from(speech.audio, "base64"), duration: speech.duration, words: toWords(graph_chars, graph_times) };
}

// graph_chars is the text one character at a time, spaces included, and graph_times has when each one
// is spoken, in seconds. An emoji is one character here but two in a JavaScript string, so this walks
// the characters instead of indexing into the text.
export function toWords(chars: string[], times: Array<[start: number, end: number]>): Word[] {
  const words: Word[] = [];
  let word: Word | undefined;
  chars.forEach((char, index) => {
    const [start, end] = times[index];
    if (/\s/.test(char)) {
      word = undefined;
    } else if (word) {
      word.text += char;
      word.end = end;
    } else {
      word = { text: char, start, end };
      words.push(word);
    }
  });
  return words;
}

// Records the paragraphs in order and reports each one as soon as it's ready, so the first can play
// while the rest are still recording.
export async function recordAll(paragraphs: string[], on: RecordEvents = {}, signal?: AbortSignal): Promise<Recording[]> {
  const recordings: Recording[] = [];
  let next = 0;
  const recordNext = async () => {
    const index = next++;
    on.recording?.(index);
    recordings[index] = await recordParagraph(paragraphs[index], signal);
    on.recorded?.(index, recordings[index]);
  };
  const keepRecording = async () => {
    while (next < paragraphs.length) await recordNext();
  };
  // Requests running at the same time sometimes slow each other down, and the listener is waiting for
  // the first paragraph, so it records on its own.
  await recordNext();
  await Promise.all(Array.from({ length: AT_ONCE }, keepRecording));
  return recordings;
}

// The voice API would take square brackets for speech tags like [pause], so they become parentheses and
// are read as words. stripInvalidSpeechTags() removes any other tag the API wouldn't recognize.
function toArticle(title: string, paragraphs: string[]): Article {
  const kept: string[] = [];
  let characters = 0;
  for (const paragraph of paragraphs) {
    const text = stripInvalidSpeechTags(paragraph.replaceAll("[", "(").replaceAll("]", ")")).replace(/\s+/g, " ").trim();
    characters += text.length;
    if (kept.length && characters > MAX_CHARACTERS) break;
    if (text) kept.push(text);
  }
  if (!kept.length) throw new Error("Couldn't find any paragraphs to read.");
  return { title, paragraphs: kept };
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x?)([\da-f]+);/gi, (_, hex: string, digits: string) => String.fromCodePoint(parseInt(digits, hex ? 16 : 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}
