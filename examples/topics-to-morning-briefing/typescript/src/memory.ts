import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const FILE = "output/memory.json";
const DAY_MS = 86_400_000;
// Grok compares what it finds with the stories reported in the last week, and the file keeps a month.
const RECALL_DAYS = 7;
const KEEP_DAYS = 30;

export type Remembered = { id: number; topic: string; headline: string; summary: string; update_of?: number; urls: string[] };
// `topics` lists only the topics the briefing researched, so a topic it skipped is searched from further back next time.
export type BriefingRecord = { at: string; from: string; to: string; topics: string[]; cost: number; stories: Remembered[] };
export type Memory = { briefings: BriefingRecord[] };
export type Window = { from: string; to: string };

export async function loadMemory(): Promise<Memory> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Memory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { briefings: [] };
    throw error;
  }
}

// Adds what a briefing covered and drops briefings older than a month, so the file stays small.
export async function remember(memory: Memory, briefing: BriefingRecord): Promise<void> {
  const cutoff = Date.now() - KEEP_DAYS * DAY_MS;
  const briefings = [...memory.briefings, briefing].filter((record) => Date.parse(record.at) > cutoff);
  await mkdir("output", { recursive: true });
  await writeFile(FILE, JSON.stringify({ briefings }, null, 2));
}

export async function forget(): Promise<void> {
  await rm(FILE, { force: true });
}

// The stories reported on a topic in the last week, oldest first, with when each was reported.
export function recall(memory: Memory, topic: string): Array<Remembered & { at: string }> {
  const cutoff = Date.now() - RECALL_DAYS * DAY_MS;
  return memory.briefings
    .filter((record) => Date.parse(record.at) > cutoff)
    .flatMap((record) => record.stories.filter((story) => sameTopic(story.topic, topic)).map((story) => ({ ...story, at: record.at })));
}

// When a briefing last researched the topic, if one has.
export function lastCovered(memory: Memory, topic: string): string | undefined {
  return memory.briefings.findLast((record) => record.topics.some((other) => sameTopic(other, topic)))?.at;
}

// Searches from the day the topic was last covered, or from yesterday the first time, through today.
export function searchWindow(since: string | undefined): Window {
  const now = Date.now();
  const start = since ? Math.max(Date.parse(since), now - RECALL_DAYS * DAY_MS) : now - DAY_MS;
  // X Search takes whole days in UTC, and to_date is exclusive, so the window ends tomorrow to include today.
  return { from: isoDate(start), to: isoDate(now + DAY_MS) };
}

export function nextStoryId(memory: Memory): number {
  return Math.max(0, ...memory.briefings.flatMap((record) => record.stories.map((story) => story.id))) + 1;
}

export function summarize(memory: Memory): { briefings: number; stories: number; last: string | null } {
  return {
    briefings: memory.briefings.length,
    stories: memory.briefings.reduce((sum, record) => sum + record.stories.length, 0),
    last: memory.briefings.at(-1)?.at ?? null,
  };
}

export function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function sameTopic(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
