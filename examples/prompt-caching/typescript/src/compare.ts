import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { COMPACT_AFTER, type ChatOptions, type Compaction, MODEL, type Turn, compactChat, newChat, sendMessage, shouldCompact } from "./chat.ts";

export const SCRIPT = readFileSync(new URL("../script.txt", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim());

// The same chat, three ways. All three tell Grok the time.
export const CHATS = {
  message: { name: "Time in the message", about: "The time starts the latest message, so each prompt starts the way the last one did.", time: "message", compact: false },
  top: { name: "Time on top", about: "The time starts the system prompt, so no two prompts start the same way.", time: "top", compact: false },
  compaction: {
    name: "With compaction",
    about: `Like the first, but every ${COMPACT_AFTER.toLocaleString("en")} tokens of turns are swapped for one summary item.`,
    time: "message",
    compact: true,
  },
} satisfies Record<string, ChatOptions & { name: string; about: string }>;

export type ChatKey = keyof typeof CHATS;
export type Results = Record<ChatKey, Turn[]>;
export type Summary = { turns: number; cost: number; cached: number; first_token_ms: number; compactions: number };

export type CompareEvents = {
  ask?: (chat: ChatKey, index: number) => void;
  text?: (chat: ChatKey, index: number, text: string) => void;
  answer?: (chat: ChatKey, index: number, turn: Turn) => void;
  compacting?: (chat: ChatKey, index: number) => void;
  compacted?: (chat: ChatKey, index: number, compaction: Compaction) => void;
  failed?: (chat: ChatKey, error: Error) => void;
};

// Plays the script in every chat at once, and reports each turn as it happens.
export async function compare(script: string[], on: CompareEvents = {}, signal?: AbortSignal): Promise<Results> {
  const keys = Object.keys(CHATS) as ChatKey[];
  const results = await Promise.all(keys.map((key) => play(key, script, on, signal)));
  return Object.fromEntries(keys.map((key, index) => [key, results[index]])) as Results;
}

async function play(key: ChatKey, script: string[], on: CompareEvents, signal?: AbortSignal): Promise<Turn[]> {
  const { time, compact } = CHATS[key];
  const chat = newChat({ time, compact });
  const turns: Turn[] = [];
  // A chat that fails is reported and stops, and the others play on.
  try {
    for (const [index, question] of script.entries()) {
      on.ask?.(key, index);
      const turn = await sendMessage(chat, question, { text: (text) => on.text?.(key, index, text) }, signal);
      turns.push(turn);
      on.answer?.(key, index, turn);
      // There's no point compacting after the last turn, since nothing comes after it.
      if (shouldCompact(chat) && index < script.length - 1) {
        on.compacting?.(key, index);
        turn.compaction = await compactChat(chat, signal);
        on.compacted?.(key, index, turn.compaction);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    on.failed?.(key, error instanceof Error ? error : new Error(String(error)));
  }
  return turns;
}

// The median time to first token, since a few slow turns would swamp an average.
export function summarize(turns: Turn[]): Summary {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const times = turns.map((turn) => turn.first_token_ms).sort((a, b) => a - b);
  return {
    turns: turns.length,
    cost: sum(turns.map((turn) => turn.cost.total + (turn.compaction?.cost.total ?? 0))),
    cached: sum(turns.map((turn) => turn.cached_tokens)) / (sum(turns.map((turn) => turn.input_tokens)) || 1),
    first_token_ms: times[Math.floor(times.length / 2)] ?? 0,
    compactions: turns.filter((turn) => turn.compaction).length,
  };
}

// Saves every turn of every chat, with a summary of each, to output/.
export async function saveResults(results: Results): Promise<string> {
  const chats = Object.fromEntries(
    Object.entries(results).map(([key, turns]) => [key, { ...CHATS[key as ChatKey], summary: summarize(turns), turns }]),
  );
  const path = `output/comparison-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  await mkdir("output", { recursive: true });
  await writeFile(path, JSON.stringify({ model: MODEL, compact_after: COMPACT_AFTER, chats }, null, 2));
  return path;
}
