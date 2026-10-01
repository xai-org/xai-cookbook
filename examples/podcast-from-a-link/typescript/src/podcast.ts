import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { type UnsafeSpeechText, xAI } from "@xai-official/sdk";

const client = new xAI();

export const HOSTS = {
  host: { name: "Eve", voice: "eve" },
  guest: { name: "Rex", voice: "rex" },
} as const;

// The voice API reads unknown tags aloud instead of rejecting them, so any tag
// outside these lists is stripped before recording.
const INLINE_TAGS = ["pause", "laugh", "chuckle", "sigh", "breath"];
const WRAPPING_TAGS = ["emphasis", "whisper", "slow"];

export type Material = { type: "input_text"; text: string } | { type: "input_file"; file_id: string };
export type Line = { speaker: keyof typeof HOSTS; text: string };
export type Script = { title: string; lines: Line[] };

export type ScriptEvents = {
  reasoning?: (text: string) => void;
  title?: (title: string) => void;
  line?: (line: Line, index: number) => void;
};

const SCRIPT_PROMPT = `You write scripts for a podcast with two co-hosts, ${HOSTS.host.name} and ${HOSTS.guest.name}. They're old friends who both read the material and talk about it as equals. It's not an interview: neither of them is the expert, and both bring facts, reactions, and opinions.
- ${HOSTS.host.name} gets excited about the surprising parts, tells them like stories, and reaches for everyday comparisons.
- ${HOSTS.guest.name} is dry and a little skeptical: pokes at big claims, cracks jokes, and comes around when something really is impressive.

Turn the material you're given into a conversation of three to four minutes, roughly 550 words.
- Go deep on the three or four most surprising ideas and leave the rest out, even the interesting bits. Use only a handful of numbers in the whole episode, and only the names and dates that matter to the story.
- Make it a conversation, not a quiz, and let the length of each turn swing the way it does when real people talk. About a third of the lines are quick jabs and reactions of a few words, and most of the rest are a sentence or two. Two or three times, one host gets going and holds the floor for a whole paragraph of six to ten sentences, telling a story, walking through how something works, or making a case, while the other just listens. Both hosts get at least one of those. Each line responds to what was just said: they add to it, joke, push back, or finish each other's thoughts.
- Questions are fine now and then, but most lines are statements, and neither host just asks while the other answers.
- Write the way people talk, with contractions and loose sentences. Explain technical ideas in plain words, as if to a friend who hasn't read it, without jargon, formulas, or references to tables and figures. Skip stock phrases like "great question", "exactly", "fascinating", and "let's dive in", and don't repeat a turn of phrase. They rarely say each other's names.
- Open in the middle of things with a short, surprising line, not a welcome. End on a natural beat, like a joke or a callback, not a summary.
- Stick to the material for facts: don't invent numbers, names, or quotes. Opinions, jokes, and comparisons can be their own.
- No markdown, lists, or URLs.
- Use speech tags sparingly, where a real person would laugh, sigh, or pause: [laugh], [chuckle], [sigh], [breath], [pause], <emphasis>a word</emphasis>, <whisper>an aside</whisper>, or <slow>a phrase</slow>. Most lines have none.`;

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short episode title" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: Object.keys(HOSTS) },
          text: { type: "string" },
        },
        required: ["speaker", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "lines"],
  additionalProperties: false,
};

export async function readSource(source: string, signal?: AbortSignal): Promise<Material> {
  if (existsSync(source)) {
    return uploadPdf(await openAsBlob(source), basename(source), signal);
  }
  const response = await fetch(source, { headers: { "user-agent": "Mozilla/5.0 (SpaceXAI cookbook)" }, signal });
  if (!response.ok) throw new Error(`Couldn't fetch ${source}: ${response.status}`);
  if (response.headers.get("content-type")?.includes("pdf")) {
    return uploadPdf(await response.blob(), "source.pdf", signal);
  }
  const text = htmlToText(await response.text()).slice(0, 60_000);
  return { type: "input_text", text: `Article from ${source}:\n\n${text}` };
}

async function uploadPdf(file: Blob, filename: string, signal?: AbortSignal): Promise<Material> {
  const uploaded = await client.files.upload({ file, filename, expires_after: 3600 }, { signal });
  return { type: "input_file", file_id: uploaded.id };
}

// Streams the script and reports each line as soon as it's complete, so callers can
// start recording before Grok has finished writing.
export async function writeScript(material: Material, on: ScriptEvents = {}, signal?: AbortSignal): Promise<Script> {
  let json = "";
  let title = false;
  let lines = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: SCRIPT_PROMPT },
        { role: "user", content: [material, { type: "input_text", text: "Write the episode." }] },
      ],
      text: { format: { type: "json_schema", name: "podcast_script", schema: SCRIPT_SCHEMA } },
      // At the default effort, Grok drafts the whole script in its reasoning before writing any
      // output, which delays the first line by minutes. Low effort gets lines streaming quickly.
      reasoning: { effort: "low" },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("text", (delta) => {
      json += delta;
      const titleMatch = !title && json.match(/"title"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (titleMatch) {
        title = true;
        on.title?.(JSON.parse(titleMatch[1]));
      }
      // Each line is a small flat object, so a complete one is a {...} with no braces inside.
      const complete = json.slice(json.indexOf('"lines"')).match(/\{[^{}]*\}/g) ?? [];
      for (; lines < complete.length; lines++) on.line?.(JSON.parse(complete[lines]), lines);
    })
    .done();
  const script = response.toJson() as Script;
  for (; lines < script.lines.length; lines++) on.line?.(script.lines[lines], lines);
  return script;
}

export async function recordLine(line: Line, signal?: AbortSignal): Promise<Uint8Array> {
  const speech = await client.voice.speak(
    {
      // The model writes this text, so it can't be checked at compile time. cleanTags() does it instead.
      text: cleanTags(line.text) as UnsafeSpeechText,
      language: "en",
      voice_id: HOSTS[line.speaker].voice,
    },
    { signal },
  );
  return speech.bytes();
}

function cleanTags(text: string): string {
  return text
    .replace(/\[([a-z-]+)\]/g, (tag, name) => (INLINE_TAGS.includes(name) ? tag : ""))
    .replace(/<\/?([a-z-]+)>/g, (tag, name) => (WRAPPING_TAGS.includes(name) ? tag : ""));
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// Runs at most `concurrency` tasks at a time, in the order they're added.
export function limit(concurrency: number) {
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
