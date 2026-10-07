import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type ServerToolCall, SpaceXAI, stripInvalidSpeechTags } from "@xai-official/sdk";
import { webSearch, xSearch } from "@xai-official/sdk/tools";
import { type Memory, type Remembered, type Window, isoDate, lastCovered, loadMemory, nextStoryId, recall, remember, searchWindow } from "./memory.ts";

// A search that fails before Grok starts answering is safe to send again, since nothing has streamed yet.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

export const DEFAULT_MAX_COST = 1;
const VOICE = "eve";
// About two minutes of speech, shared between the topics.
const BRIEFING_WORDS = 270;
// The voice API doesn't report what a request cost, so speech is counted at its price per character.
const SPEECH_USD_PER_CHAR = 15 / 1_000_000;
// At a constant bit rate, a clip's length follows from its size.
const AUDIO = { codec: "mp3", sample_rate: 24_000, bit_rate: 128_000 } as const;

export type Post = { url: string; author: string; text: string };
export type Article = { url: string; title: string; site: string };
export type Story = { id: number; status: "new" | "update" | "old"; update_of?: number; headline: string; summary: string; posts: Post[]; articles: Article[] };
export type TopicReport = { topic: string; stories: Story[]; script: string; cost: number; posts: number; searches: number };
export type Search = { tool: "x" | "web"; text: string };
export type Clip = { path: string; bytes: Uint8Array; seconds: number };
export type Plan = Window & { remembered: number; briefings: number; clips: string[] };
export type Briefing = Window & { dir: string; file: string; seconds: number; cost: number; reports: Array<TopicReport | undefined>; skipped: string[] };

export type BriefingEvents = {
  start?: (plan: Plan) => void;
  topic?: (index: number, remembered: number) => void;
  search?: (index: number, search: Search) => void;
  reasoning?: (index: number, text: string) => void;
  writing?: (index: number) => void;
  // Also gets what the briefing has cost so far.
  report?: (index: number, report: TopicReport, spent: number) => void;
  // A topic is skipped when it could go over the cost cap, or when its search failed.
  skipped?: (index: number, reason: string) => void;
  clip?: (index: number, clip: Clip, text: string) => void;
};

type Draft = Omit<Story, "id" | "update_of"> & { previous_id: number };
type Research = { drafts: Draft[]; script: string; cost: number; posts: number; searches: number };
type Assignment = { topic: string; after: string; words: number; window: Window; last?: string; remembered: Array<Remembered & { at: string }> };
type TopicEvents = { search?: (search: Search) => void; reasoning?: (text: string) => void; writing?: () => void };

const POST_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string" },
    author: { type: "string", description: "The author's X handle, without the @" },
    text: { type: "string", description: "The full text of the post" },
  },
  required: ["url", "author", "text"],
  additionalProperties: false,
};

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string" },
    title: { type: "string" },
    site: { type: "string", description: "The name of the publication" },
  },
  required: ["url", "title", "site"],
  additionalProperties: false,
};

// The stories come before the script, so Grok decides what's new before it writes about it.
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["new", "update", "old"] },
          previous_id: { type: "integer", description: "The number of the earlier story this one updates or repeats, or 0 for a new story" },
          headline: { type: "string" },
          summary: { type: "string", description: "What happened, in one or two sentences. For an update, what changed." },
          posts: { type: "array", items: POST_SCHEMA },
          articles: { type: "array", items: ARTICLE_SCHEMA },
        },
        required: ["status", "previous_id", "headline", "summary", "posts", "articles"],
        additionalProperties: false,
      },
    },
    script: { type: "string", description: "What the host says about this topic" },
  },
  required: ["stories", "script"],
  additionalProperties: false,
};

// One topic per line. The terminal app briefs these unless it's given others, and the page starts with them.
export async function readTopics(): Promise<string[]> {
  const text = await readFile(new URL("../topics.txt", import.meta.url), "utf8");
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

// Researches the topics one at a time and voices each one while the next is researched, reporting every step as
// it happens. Saves the clips and the whole briefing to output/<time>/, and what it covered to the memory file.
export async function makeBriefing(topics: string[], maxCost: number, on: BriefingEvents = {}, signal?: AbortSignal): Promise<Briefing> {
  const memory = await loadMemory();
  const since = topics.map((topic) => lastCovered(memory, topic));
  const windows = since.map(searchWindow);
  const window = { from: windows.map((each) => each.from).sort()[0], to: windows[0].to };
  const at = new Date();
  const dir = `output/${folderName(at)}`;
  await mkdir(dir, { recursive: true });
  const remembered = topics.map((topic) => recall(memory, topic));
  on.start?.({ ...window, remembered: remembered.flat().length, briefings: memory.briefings.length, clips: ["Intro", ...topics, "Outro"] });

  let spent = 0;
  const clips: Array<Promise<Clip> | undefined> = [];
  const speak = (index: number, script: string) => {
    // Grok writes the script, so the SDK can't check its speech tags at compile time. Any tag the voice API
    // wouldn't recognize is removed instead, so it isn't read aloud.
    const text = stripInvalidSpeechTags(script);
    spent += text.length * SPEECH_USD_PER_CHAR;
    const clip = recordClip(`${dir}/clip-${index}.mp3`, text, signal).then((recorded) => {
      on.clip?.(index, recorded, text);
      return recorded;
    });
    // The clips are awaited once every topic is done. Until then, this keeps a failed one from crashing the process.
    clip.catch(() => {});
    clips[index] = clip;
  };

  speak(0, intro(topics, memory));
  const reports: Array<TopicReport | undefined> = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  // The API reports what a request cost only when it's done, so a topic can't be stopped partway. Instead, a
  // topic starts only if it would fit under the cap at the cost of the priciest topic so far. Before any topic has
  // run, that's the average cost of a topic in the last briefing that researched one.
  const last = memory.briefings.findLast((record) => record.topics.length);
  let estimate = last ? last.cost / last.topics.length : 0;
  let nextId = nextStoryId(memory);
  for (const [index, topic] of topics.entries()) {
    if (spent + estimate > maxCost) {
      skipped.push(topic);
      on.skipped?.(index, `Skipped to stay under the $${maxCost.toFixed(2)} cap`);
      continue;
    }
    on.topic?.(index, remembered[index].length);
    try {
      const research = await researchTopic(
        {
          topic,
          after: index === 0 ? "the intro" : `the segment on ${topics[index - 1]}`,
          words: Math.max(40, Math.round(BRIEFING_WORDS / topics.length)),
          window: windows[index],
          last: since[index],
          remembered: remembered[index],
        },
        {
          search: (search) => on.search?.(index, search),
          reasoning: (text) => on.reasoning?.(index, text),
          writing: () => on.writing?.(index),
        },
        signal,
      );
      spent += research.cost;
      estimate = Math.max(estimate, research.cost);
      const { drafts, ...rest } = research;
      reports[index] = { topic, ...rest, stories: settle(drafts, remembered[index], () => nextId++) };
      speak(index + 1, research.script);
      on.report?.(index, reports[index], spent);
    } catch (error) {
      if (signal?.aborted) throw error;
      failed.push(topic);
      on.skipped?.(index, `The search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  speak(topics.length + 1, outro(reports, skipped, failed));

  const recorded = (await Promise.all(clips)).filter((clip) => clip !== undefined);
  const file = `${dir}/briefing.mp3`;
  // MP3 frames can be joined end to end, so the clips play back as one file.
  await writeFile(file, Buffer.concat(recorded.map((clip) => clip.bytes)));
  const researched = topics.filter((_, index) => reports[index]);
  await remember(memory, { at: at.toISOString(), ...window, topics: researched, cost: spent, stories: covered(reports) });
  const seconds = recorded.reduce((sum, clip) => sum + clip.seconds, 0);
  return { ...window, dir, file, seconds, cost: spent, reports, skipped: [...skipped, ...failed] };
}

// Searches 𝕏 within the window and the web, then reports the stories it found, which of them are new, and the
// script for this topic, as structured output.
async function researchTopic(assignment: Assignment, on: TopicEvents, signal?: AbortSignal): Promise<Research> {
  const { window } = assignment;
  const cited = new Set<string>();
  let writing = false;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // The searches do the work here, so low effort keeps a topic to seconds instead of minutes.
      reasoning: { effort: "low" },
      // A request's cost is only known once it's done, so this bounds how many rounds of searches one topic runs.
      max_turns: 6,
      input: [
        { role: "system", content: reportPrompt(assignment) },
        { role: "user", content: `Topic: ${assignment.topic}` },
      ],
      tools: [xSearch({ from_date: window.from, to_date: window.to }), webSearch()],
      text: { format: { type: "json_schema", name: "topic_report", schema: REPORT_SCHEMA } },
      stream: true,
    },
    // A streamed request has no idle timeout unless it's given one, and a scheduled run shouldn't wait the default
    // hour on a stream that has stalled. The searches send events as they run, so two quiet minutes means it's stuck.
    { signal, idleTimeout: 120_000 },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("server_tool_call", (call) => {
      const search = describeSearch(call);
      if (search) on.search?.(search);
    })
    .on("text", () => {
      if (!writing) on.writing?.();
      writing = true;
    })
    .on("citation", (citation) => cited.add(sourceKey(citation.url)))
    .done();
  const { stories, script } = response.toJson() as { stories: Draft[]; script: string };
  const tools = response.usage.server_side_tool_usage_details;
  return {
    // Grok cites every post and page its searches returned, so keeping only cited sources rules out made-up ones.
    drafts: stories.slice(0, 6).map((story) => ({
      ...story,
      headline: stripCitations(story.headline),
      summary: stripCitations(story.summary),
      posts: story.posts.filter((post) => cited.has(sourceKey(post.url))).slice(0, 3),
      articles: story.articles.filter((article) => cited.has(sourceKey(article.url))).slice(0, 3),
    })),
    script: stripCitations(script),
    cost: response.usage.cost_usd ?? 0,
    posts: tools?.x_posts_fetched ?? 0,
    searches: (tools?.x_search_calls ?? 0) + (tools?.web_search_calls ?? 0),
  };
}

function reportPrompt({ after, words, window, last, remembered }: Assignment): string {
  const today = isoDate(Date.now());
  // X Search only takes whole days, so the window starts at midnight on the day of the last briefing, and Grok
  // uses the briefing's exact time to tell what broke after it.
  const since = last ? `the last briefing, which went out at ${last.slice(11, 16)} UTC on ${last.slice(0, 10)}` : window.from;
  const earlier = remembered.length
    ? remembered.map((story) => `#${story.id}, reported ${story.at.slice(0, 10)}: ${story.headline}. ${story.summary}`).join("\n")
    : "None yet.";
  return `You research and write one topic of a short spoken news briefing. Today is ${today} (UTC), and the briefing covers what happened since ${since}.

1. Search 𝕏 and the web for news about the topic in that time. On 𝕏, look for posts from the people, companies, and reporters involved, and skip ads, giveaways, and reposts. On the web, look for news articles published in that time.
2. Compare what you find with the stories already reported in earlier briefings, listed below. A story is "new" if it isn't in the list and it broke in that time. It's an "update" if it's in the list and something has happened since, like a launch, a result, a decision, or an announcement. More detail about the same news, like an exact time or a plan restated, isn't an update, so that story is "old", like any story in the list where nothing has happened. For an update or an old story, set previous_id to its number, and for an update, make the headline and summary about what changed.
3. List at most three new stories and updates, most important first, and leave out rumors and stories that are mainly about something else. After them, list the stories from the list that you came across again, as old.
4. For each new story and update, list up to three 𝕏 posts and three articles it's based on, exactly as the searches returned them. Only list articles about the story itself, not section, tag, or live pages. Don't make up or paraphrase posts. Leave both lists empty for old stories.
5. Write the script, what the host says about this topic, in at most ${words} words. It comes after ${after}, so open with a short transition that names the topic. Cover the new stories and updates, and for an update, say only what changed. If there's nothing new, say so in one sentence, and if an earlier story is still the latest, name it. Write for the ear: short sentences, numbers the way you'd say them, and no citations, URLs, lists, or markdown. Use at most two speech tags, where a newsreader would: [pause] between stories, [breath] before a long sentence, or <emphasis>a key word</emphasis>.

Stories already reported on this topic:
${earlier}`;
}

// Grok decides which stories are new. An update or a repeat has to point at a story it was shown, or it counts
// as new, and every story reported for the first time gets the next number.
function settle(drafts: Draft[], remembered: Remembered[], nextId: () => number): Story[] {
  const known = new Set(remembered.map((story) => story.id));
  return drafts.map(({ previous_id, ...draft }) => {
    const status = draft.status !== "new" && known.has(previous_id) ? draft.status : "new";
    if (status === "old") return { ...draft, status, id: previous_id };
    return { ...draft, status, id: nextId(), update_of: status === "update" ? previous_id : undefined };
  });
}

function covered(reports: Array<TopicReport | undefined>): Remembered[] {
  return reports.flatMap((report) =>
    report
      ? report.stories
          .filter((story) => story.status !== "old")
          .map(({ id, update_of, headline, summary, posts, articles }) => ({
            id,
            topic: report.topic,
            headline,
            summary,
            update_of,
            urls: [...posts, ...articles].map((source) => source.url),
          }))
      : [],
  );
}

async function recordClip(path: string, text: string, signal?: AbortSignal): Promise<Clip> {
  const speech = await client.voice.speak({ text, language: "en", voice_id: VOICE, output_format: AUDIO }, { signal });
  const bytes = await speech.bytes();
  await writeFile(path, bytes);
  return { path, bytes, seconds: bytes.length / (AUDIO.bit_rate / 8) };
}

function intro(topics: string[], memory: Memory): string {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const since = memory.briefings.length ? "since your last briefing" : "since yesterday";
  return `${greeting}. It's ${day}. Here's what's changed on ${list(topics)} ${since}.`;
}

function outro(reports: Array<TopicReport | undefined>, skipped: string[], failed: string[]): string {
  const lines: string[] = [];
  if (failed.length) lines.push(`I couldn't check ${list(failed)} this time.`);
  if (skipped.length) lines.push(`I skipped ${list(skipped)} to stay under this briefing's cost limit.`);
  const news = reports.some((report) => report?.stories.some((story) => story.status !== "old"));
  lines.push(news ? "That's your briefing. The posts and articles behind each story are in the notes." : "That's all for now.");
  return lines.join(" ");
}

// X searches arrive as custom tool calls with their arguments as JSON, and web searches and page visits as
// web_search_call. A listener that throws would end the stream, so bad JSON is skipped.
function describeSearch(call: ServerToolCall): Search | undefined {
  if (call.type === "custom_tool_call") {
    try {
      const { query } = JSON.parse(call.input ?? "{}") as { query?: string };
      return { tool: "x", text: query ?? call.name };
    } catch {
      return { tool: "x", text: call.name };
    }
  }
  if (call.type === "web_search_call") {
    return { tool: "web", text: call.action.type === "search" ? call.action.query : call.action.url };
  }
}

// Now and then Grok cites a source inside the text, as <citation id="web:3"/> or [[3]](url), and the voice would
// read it out.
function stripCitations(text: string): string {
  return text
    .replace(/\s*<citation\b[^>]*\/>|\s*\[\[\d+\]\]\([^)\s]*\)/g, "")
    .replace(/<citation\b[^>]*>|<\/citation>/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

// X cites a post as x.com/i/status/<id> or x.com/<handle>/status/<id>, so posts match by ID, and pages by
// host and path.
function sourceKey(url: string): string {
  const post = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/(\d+)/)?.[1];
  if (post) return `post:${post}`;
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname.replace(/^www\./, "")}${pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

function list(items: string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(items);
}

function folderName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
