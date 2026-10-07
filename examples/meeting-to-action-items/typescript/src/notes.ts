import { SpaceXAI } from "@xai-official/sdk";
import type { Line } from "./transcribe.ts";

const client = new SpaceXAI();

export type Decision = { id: string; text: string; line: number };
export type ActionItem = { id: string; task: string; owner: string; due: string; line: number };
export type Speaker = { speaker: number; name: string };
export type Notes = { speakers: Speaker[]; decisions: Decision[]; action_items: ActionItem[]; summary: string };
export type Item = Decision | ActionItem;
export type List = "decisions" | "action_items";

export const NO_NOTES: Notes = { speakers: [], decisions: [], action_items: [], summary: "" };

export type NotesEvents = {
  // A decision or action item that's new or different, as soon as Grok has written it.
  change?: (list: List, item: Item, previous: Item | undefined) => void;
  speakers?: (speakers: Speaker[]) => void;
};

export type AnswerEvents = {
  reasoning?: (text: string) => void;
  text?: (text: string) => void;
};

const NOTES_PROMPT = `You keep the notes during a meeting. Each time, you get the notes so far as JSON, the last few lines they already cover, and the newest lines of the transcript, and you return all of the notes, revised.
- decisions: what the group agreed on, a few words each, like "Launch on October 21". Only firm agreements, not ideas, proposals, or open questions.
- action_items: things someone said they'll do, or agreed to do when asked. task is a few words that start with a verb. owner is the person's name, or Speaker N until you know it, or empty if nobody took it on. due is when it's due, as they said it, like "Thursday", or empty.
- line is the number of the transcript line where the item was agreed, or where it last changed.
- When the conversation changes an item, like a new date, price, or owner, update that item instead of adding another. Remove an item only if the group drops it.
- Keep every item's id. A new decision gets the next number after the highest so far, like d3, and a new action item likewise, like a4.
- speakers: the name of each speaker the transcript reveals, for example when one speaker greets, thanks, or asks another by name. Leave out speakers you can't name yet.
- summary: one or two sentences on what the meeting has covered so far.
- The transcript comes from speech recognition, so expect small mistakes. Don't make up names, dates, or numbers.`;

const ANSWER_PROMPT = `You answer questions about a meeting from its transcript. Each line of the transcript starts with its number in brackets. Answer in one to three sentences, and right after each statement, cite the lines it comes from by number, like [12] or [12][15]. If the transcript doesn't answer the question, say so.`;

// Grok writes the fields in this order, so the speakers' names arrive before the lists are rewritten, and
// the summary, which changes the most, comes last.
const NOTES_SCHEMA = {
  type: "object",
  properties: {
    speakers: {
      type: "array",
      items: {
        type: "object",
        properties: { speaker: { type: "integer", description: "N in Speaker N" }, name: { type: "string" } },
        required: ["speaker", "name"],
        additionalProperties: false,
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" }, line: { type: "integer" } },
        required: ["id", "text", "line"],
        additionalProperties: false,
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          task: { type: "string" },
          owner: { type: "string" },
          due: { type: "string" },
          line: { type: "integer" },
        },
        required: ["id", "task", "owner", "due", "line"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["speakers", "decisions", "action_items", "summary"],
  additionalProperties: false,
};

// Sends Grok the notes so far and only the lines spoken since, and gets back all of the notes, revised. Each
// new or changed item is reported as soon as Grok has written it, while the rest of the notes stream in.
// The earlier lines are already in the notes. They're there so Grok can tell who "you" is, or who was
// greeted by name a turn before.
export async function reviseNotes(
  notes: Notes,
  lines: Line[],
  earlier: Line[],
  on: NotesEvents = {},
  options: { cacheKey?: string; signal?: AbortSignal } = {},
): Promise<{ notes: Notes; cost: number }> {
  const context = earlier.length ? `The lines just before, which the notes already cover:\n${transcript(earlier)}\n\n` : "";
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: NOTES_PROMPT },
        { role: "user", content: `The notes so far:\n${JSON.stringify(notes)}\n\n${context}The new lines:\n${transcript(lines)}` },
      ],
      text: { format: { type: "json_schema", name: "meeting_notes", schema: NOTES_SCHEMA } },
      // The notes are revised after every turn, so a revision has to be quick. In one test the same revision
      // took 2.5 seconds at low effort and 6.7 at the default effort, with the same result.
      reasoning: { effort: "low" },
      prompt_cache_key: options.cacheKey,
      stream: true,
    },
    { signal: options.signal },
  );

  const before = new Map<string, Item>([...notes.decisions, ...notes.action_items].map((item) => [item.id, item]));
  const reported = new Set<string>();
  let named = false;
  const report = (partial: Partial<Notes>, complete: boolean) => {
    if (!named && (complete || partial.decisions)) {
      named = true;
      if (JSON.stringify(partial.speakers) !== JSON.stringify(notes.speakers)) on.speakers?.(partial.speakers ?? []);
    }
    const lists: Array<[List, Item[]]> = [
      ["decisions", finished(partial.decisions, complete || partial.action_items !== undefined)],
      ["action_items", finished(partial.action_items, complete || partial.summary !== undefined)],
    ];
    for (const [list, items] of lists) {
      for (const item of items.filter((item) => !reported.has(item.id))) {
        reported.add(item.id);
        if (JSON.stringify(item) !== JSON.stringify(before.get(item.id))) on.change?.(list, item, before.get(item.id));
      }
    }
  };

  const response = await stream.on("json", (value) => report(value as Partial<Notes>, false)).done();
  const revised = response.toJson() as Notes;
  report(revised, true);
  return { notes: revised, cost: response.usage.cost_usd ?? 0 };
}

// Answers a question about the meeting so far, citing the lines it comes from, like [12].
export async function answer(
  question: string,
  lines: Line[],
  notes: Notes,
  on: AnswerEvents = {},
  options: { cacheKey?: string; signal?: AbortSignal } = {},
): Promise<{ text: string; cost: number }> {
  const names = notes.speakers.map(({ speaker, name }) => `Speaker ${speaker} is ${name}.\n`).join("");
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: ANSWER_PROMPT },
        // The transcript only grows at the end, so it goes before the question, and every question in the
        // meeting can reuse the cached start of the prompt.
        { role: "user", content: `${transcript(lines)}\n\n${names}Question: ${question}` },
      ],
      reasoning: { effort: "low" },
      prompt_cache_key: options.cacheKey,
      stream: true,
    },
    { signal: options.signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("text", (text) => on.text?.(text))
    .done();
  return { text: response.toText(), cost: response.usage.cost_usd ?? 0 };
}

export function notesMarkdown(title: string, notes: Notes, lines: Line[]): string {
  const name = (speaker: number) => notes.speakers.find((known) => known.speaker === speaker)?.name ?? `Speaker ${speaker}`;
  const sections = [`# ${title}`, notes.summary];
  if (notes.decisions.length) sections.push("## Decisions", notes.decisions.map((decision) => `- ${decision.text}`).join("\n"));
  if (notes.action_items.length) {
    const items = notes.action_items.map((item) => {
      const details = [item.owner, item.due].filter(Boolean).join(", ");
      return `- [ ] ${item.task}${details ? ` (${details})` : ""}`;
    });
    sections.push("## Action items", items.join("\n"));
  }
  sections.push("## Transcript", lines.map((line) => `**${name(line.speaker)}** ${clock(line.start)}  \n${line.text}`).join("\n\n"));
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

export function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function transcript(lines: Line[]): string {
  return lines.map((line) => `[${line.id}] ${clock(line.start)} Speaker ${line.speaker}: ${line.text}`).join("\n");
}

// In JSON that's still streaming, every item of a list but the last is finished, and the last one is too
// once the next field has started.
function finished<T>(items: T[] | undefined, listDone: boolean): T[] {
  if (!items) return [];
  return listDone ? items : items.slice(0, -1);
}
