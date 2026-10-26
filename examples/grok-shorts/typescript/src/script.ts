import { NotFoundError, type ResponseStream, type ServerToolCall, SpaceXAI, type Tool } from "@xai-official/sdk";
import { webSearch, xSearch } from "@xai-official/sdk/tools";
import type { ChangedFile, PullRequest, Row } from "./github.ts";
import { sourceLabel } from "./media.ts";
import type { Persona } from "./persona.ts";
import { sourceTools, sourcesBrief } from "./sources.ts";
import { THEMES, THEME_IDS, type ThemeId, freshTheme } from "./themes.ts";

// A Grok request that fails before Grok writes anything is sent again, since the whole video waits on it.
const client = new SpaceXAI({ retryBeforeOutput: true });

// Lockfiles and minified files change a lot of lines that nobody needs explained.
const SKIPPED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$/;
// About 25,000 tokens of diff. Files past this are listed without their diffs.
const MAX_DIFF_CHARACTERS = 100_000;
// Minified or generated lines can run to thousands of characters, and the video cuts them off anyway.
const MAX_ROW_CHARACTERS = 300;
// The presenter says about 170 words a minute, so this is 30 to 50 seconds. Asked for "about" a number of words,
// Grok wrote a third to a half more. Asked for "at most", it lands close to it.
const MIN_WORDS = 80;
const MAX_WORDS = 140;
const IDEA_WORDS = 110;

export const MOODS = ["chill", "shocked", "smug", "facepalm"] as const;
export type Mood = (typeof MOODS)[number];
// Something small the presenter does while saying a line, so no two takes move the same way. "point" is pointing up at
// what's shown above them, which only a split or a visual laid over their video has.
export const GESTURES = ["none", "count", "lean", "remember", "laugh", "shrug", "nod", "hands", "sigh", "squint", "headshake", "glance", "point"] as const;
export type Gesture = (typeof GESTURES)[number];
// How a segment is framed: the visual above the presenter, the presenter filling the screen, the presenter filling the
// screen with the visual laid over their video, the presenter in front of the visual like a green screen, or the visual
// alone.
export const LAYOUTS = ["split", "full", "overlay", "green", "visual"] as const;
export type Layout = (typeof LAYOUTS)[number];

// One segment of the video: the presenter says `line` in one take, while `screen` is shown the way `layout` frames it.
// `acting` says how the take is acted when it isn't in the presenter's personality, and is empty otherwise. `gesture` is
// the small thing they do as they say it; scripts written before gestures have none.
// `trim` is how many seconds more to cut from the start and end of the segment's take than the app would, set on the
// timeline: less than 0 keeps more of it.
export type Segment = { kind: "hook" | "why" | "beat" | "ending"; label: string; emoji: string; mood: Mood; gesture?: Gesture; line: string; screen: Screen; layout: Layout; acting: string; trim?: Trim };
export type Trim = { head: number; tail: number };
// What's shown: the hook in huge letters, the pull request, rows of a file's diff, a picture or a short clip that Grok
// Imagine makes from `prompt`, a screenshot of a page, an X post, a few seconds of a video, a motion graphic, or words
// stamped on at the end. A page, post, or clip that can't be fetched is replaced by a picture drawn from its `prompt`.
// A video with `play` plays that many seconds with its own sound before the line, the way a creator stitches someone
// else's video, and the line answers it.
export type Screen =
  | { kind: "headline" }
  | { kind: "pull-request" }
  | { kind: "code"; file: string; from: number; to: number }
  | { kind: "picture"; prompt: string }
  | { kind: "broll"; prompt: string }
  | { kind: "page"; url: string; prompt: string }
  | { kind: "post"; url: string; prompt: string }
  | { kind: "clip"; url: string; start: number; prompt: string; play?: number }
  | { kind: "upload"; asset: string; prompt: string }
  | { kind: "motion"; motion: Motion }
  | { kind: "stamp"; text: string };
// A motion graphic, animated from what Grok writes: a flow of steps with arrows between them, a hub with what connects to
// it around it, bars comparing numbers, a list of steps, or one big number. Each item comes on screen as the presenter
// says its `cue`, a word of the line. `value` is for bars and the number, which show `unit` after it.
export const MOTION_STYLES = ["flow", "hub", "bars", "steps", "stat"] as const;
export type Motion = { style: (typeof MOTION_STYLES)[number]; title: string; unit: string; items: Array<{ label: string; detail: string; value: number; cue: string }> };
// What the video is about: a pull request, with anything else the person asked for, or an idea in their own words.
export type Source = { pr: PullRequest; ask?: string } | { idea: string };
// A question Grok asks before it writes, with a few likely answers to pick from.
export type Question = { question: string; choices: string[] };
// A conversation with Grok about one video. Every reply is the whole script again, as segments, with the theme the words
// on screen are drawn in, and `responseId` lets the next message carry on from it. The segments are empty while Grok
// waits for answers to its questions. `look` is how the presenter looks, as Grok was told. `sources` has every page,
// post, and video Grok found in its searches so far, and `edits` the changes made by hand since Grok's last reply, to
// tell Grok with the next message.
export type Draft = {
  source: Source;
  title: string;
  personality: string;
  persona: Persona;
  look: string;
  theme: ThemeId;
  segments: Segment[];
  responseId: string;
  sources: string[];
  edits: string[];
  sound?: Sound;
};
// What a video sounds like besides the presenter: music from the library under all of it, how loud from 0 to 1, and
// whether the sound effects play.
export type Sound = { music?: string; volume: number; effects: boolean };
export const DEFAULT_SOUND: Sound = { volume: 0.5, effects: true };
export type ScriptEvents = {
  reasoning?: (text: string) => void;
  // `where` is "web", "x", or the name of a connected source Grok read from, with the tool it used.
  research?: (where: string, query: string) => void;
  note?: (note: string) => void;
  questions?: (questions: Question[]) => void;
  segment?: (segment: Segment, index: number) => void;
};

const SPOKEN_RULES = `The presenter's personality decides how every line sounds, from the hook to the end, so write all of it in that voice.

The presenter says about three words a second. When the person asks for a length, count it out, like 60 words in all the lines together for 20 seconds, and fit the script into it with shorter lines and fewer beats, down to one.

A real person says the lines on camera, so write every line the way it's said out loud:
- Code names become plain words: "on error" for onError, "parse args" for parse_args, and "the compose module" for compose.ts. Numbers and symbols are words too, like "four oh four" or "two hundred".
- No emoji, symbols, paths, URLs, or code in a line.
- Sound unscripted, the way people talk when they film themselves: now and then start mid-thought, like "Okay so" or "Look,", correct yourself once, like "it's three, no, four steps", or let a sentence trail off. At most one of these in a line, in about half the lines, and never in the hook's first words. No "um" or "uh".

Every part has a layout, for how it's framed:
- overlay: the presenter fills the screen, the way they filmed themselves on their phone, with the visual laid over their video, the way a creator drops a screenshot, a clip, or a window of code onto what they filmed.
- full: the presenter fills the screen.
- split: the visual fills the top half of the screen, edge to edge, and the presenter the bottom half.
- green: the visual fills the screen, and the presenter, cut out like on a green screen, stands in front of it and covers the bottom of it. Only for a picture, a video, or the diff, which stays above them, never for a screenshot, page, or post that needs reading.
- visual: the visual fills the screen while the presenter talks over it.
The hook and the ending are words on screen, so they're full screen, or split for a change of pace. Mix layouts the way a creator edits: open on the presenter, lay screenshots, pages, posts, clips, and code over their video, use each layout only for a part or two, and give only the best visual the whole screen.

Every part also has acting. Leave it empty to act the part in the presenter's personality, or describe how this part is acted when the person wants a different style for it, like a burst of Gen Z energy on the hook before a calm teacher takes over. A part acted in another style is written in that style too.

After you write the script, the person may ask for changes. Then write the whole script again with just those changes, and keep every other line word for word, since every changed line is filmed again. Keep anything they say they changed by hand.`;

const NOTE = "- note: one or two sentences to the person you're making the video with, about what you wrote or changed, the way a collaborator would say it. It isn't part of the video.";
const THEME = `- theme: the colors and letters of the words on screen, to suit the video and the personality. One of: ${THEME_IDS.map((id) => `${id}, ${THEMES[id].summary.charAt(0).toLowerCase()}${THEMES[id].summary.slice(1, -1)}`).join("; ")}.`;
const MOOD = "how the presenter reacts while saying it. chill is relaxed, shocked is a jaw-drop, smug is pleased with how it turned out, facepalm is disappointed.";
const GRAPHIC_RULES = `a motion graphic the app animates in the video's colors, for a beat that's clearer drawn out than shown: how something works, how pieces connect, numbers to compare, steps, or one number that matters. Its style: flow (two to five steps with arrows between them, for how something works or a process), hub (one thing at the center, first, and two to five around it, for what connects to it), bars (two to five numbers to compare, each with a value, in the unit they share), steps (two to five short steps or points, in order), or stat (one number that matters, with its value, unit, and label). A short title, or empty. Each item has a label of one to four words, a detail of at most six words or empty, a value for bars and stat or else 0, and a cue: the one word of the line that brings it on screen as the presenter says it, in the order they say them. Laid over the presenter's video, a graphic only has room for a stat or up to three items, so a hub or a longer one goes in a split or fills the screen. Keep to numbers you found or I gave you.`;
const GESTURE = `one small thing the presenter does while saying it, so no two takes move the same way: none, count (counts the points off on their fingers, for a list), lean (leans into the lens, like sharing a secret), remember (eyes flick up, like remembering), laugh (a short half-laugh), shrug, nod (nods along), hands (talks with their hands), sigh (a quick, exasperated exhale), squint (skeptical), headshake (a slow shake of the head), glance (looks away for a second, then back), or point (points up at what's shown above them, only in a split or an overlay, and at most twice in the video). Never the same one in two parts in a row, and none for about a third of the parts.`;

const PULL_REQUEST_PROMPT = `You write a short vertical video that explains a pull request like a viral TikTok, together with the person who asked for it. A developer films it talking straight into the phone camera, with the pull request and its diff on screen. Each part is its own take, with a jump cut between them, and the words pop up as captions.

Reply with:
${NOTE}
${THEME}
- hook: the opening line, said in the first three seconds. It decides whether anyone keeps watching, so make it a great one. In one or two short sentences, say what this is about and why a developer should care: name the project or the feature, and lead with the stakes, like a concrete symptom, a surprising number, or a bold claim the video goes on to back up. Leave a question that the rest of the video answers. Use plain words, so a developer who has never seen this code gets it on first listen. Two examples of the shape: "If you use ky, your retry limit might be lying to you." and "Express could never cache a QUERY request. One line fixed it." At most 20 words. emoji: one emoji shown with it. mood: ${MOOD} gesture: ${GESTURE} layout: as below.
- why: the context, right after the hook, said over a card showing the pull request. Who runs into this and when, what it costs them, and why the pull request exists, from its description, its commits, and the code. One to three sentences. emoji, mood, gesture, and layout, as for the hook.
- beats: two or three quick moments that show the change, usually the cause, the fix, and the proof.
  - label: two or three words naming the beat, like "the bug", "the fix", "the receipts", or "plot twist".
  - emoji: one emoji for the beat.
  - file, from, to: the file, exactly as listed, and the range of rows in its diff to highlight: the rows the line is about, at most eight.
  - graphic: style none, with an empty title, unit, and items, so the beat shows its rows. At most one beat can show a graphic instead, when it's about how pieces connect or how something flows: ${GRAPHIC_RULES}
  - mood, gesture, and layout: as for the hook.
  - line: what the presenter says, one or two short, punchy sentences.
- verdict: the closer. text: at most four words for the screen, like "ship it" or "check the cache". emoji, mood, gesture, layout, and line: a punchline that also tells the reviewer whether it's safe to approve and what to check.

Make it entertaining, but every technical claim has to be true to the pull request: don't invent problems, users, or numbers it doesn't show.

${SPOKEN_RULES}`;

const IDEA_PROMPT = `You write a short vertical video like a viral TikTok, about whatever the person you're making it with asks for. A creator films it talking straight into the phone camera, with a visual on screen for each beat. Each part is its own take, with a jump cut between them, and the words pop up as captions.

Research it with web search and X search, so every fact is right and the beats can show real things. Look up each product, company, person, and event the video is about, not only the words of the request: its official pages and docs, its launch posts, and posts and videos that show it in use. When the video is about a product, show the product itself wherever you can, like its docs, its launch page, or a post with a screenshot or a video of it.

Reply with:
${NOTE}
- title: a few words naming the video.
${THEME}
- hook: the opening line, said in the first three seconds. It decides whether anyone keeps watching, so make it a great one: a surprising fact, a bold claim, or a question the video answers, in plain words. At most 20 words. emoji: one emoji shown with it. mood: ${MOOD} gesture: ${GESTURE} layout: as below.
- beats: two to four quick moments that deliver the video, like the points of a list, the steps of a how-to, or the turns of a story.
  - label: two or three words naming the beat, like "step one", "the catch", or "plot twist".
  - emoji: one emoji for the beat.
  - visual: what's shown during the beat.
    - kind: page, for a screenshot of a web page you found, like an article, a product page, or docs. post, for an X post you found. clip, for a few seconds of a video on X or YouTube you found. broll, for a short clip that Grok Imagine films from your prompt. picture, for an image that Grok Imagine draws. upload, for one of the creator's own uploads, if the request lists any. graphic, for a motion graphic you describe in graphic. Real pages, posts, and clips are best when they show the very thing the line is about, and the creator's uploads are best of all when they fit.
    - url: for a page, post, or clip, its exact URL from your searches. For an upload, its id. Otherwise empty.
    - start: for a clip, the second the part worth showing starts at. Otherwise 0.
    - play: for a clip whose sound is the point, like what someone says in it, a reaction, or a sound, how many seconds of it play with their own sound before the presenter says the line, from 3 to 8, like a stitch on TikTok. While it plays, the presenter watches and reacts without a word: in a green layout, cut out in front of it, the way X's React with Video does, and in any other, under it. The line then answers it. Otherwise 0, and at most two in a video.
    - prompt: for a picture or broll, what it shows, as a prompt for an image or video model: the subject, the setting, and the style. For a page, post, or clip, a picture to draw instead if it can't be fetched. It can't have any words in it.
    - graphic: for a graphic, ${GRAPHIC_RULES} For any other visual, style none, with an empty title, unit, and items.
  - mood, gesture, and layout: as for the hook.
  - line: what the presenter says, one to three short, punchy sentences.
- closer: the last part. text: at most four words for the screen, like "try it tonight" or "you're welcome". emoji, mood, gesture, layout, and line: a punchline, a takeaway, or a call to action that ends the video.

Make it entertaining, and keep facts true: don't make up numbers, quotes, or events, unless the person asks for something made up, like a story. The presenter speaks as themselves: never have them claim to be someone else, or put words in a real person's mouth. Each line is one take of at most 15 seconds, so keep every line under 35 words.

${SPOKEN_RULES}`;

const MOOD_FIELD = { type: "string", enum: MOODS };
const GESTURE_FIELD = { type: "string", enum: GESTURES };
const LAYOUT_FIELD = { type: "string", enum: LAYOUTS };
const ACTING_FIELD = { type: "string" };
const SPOKEN_PART = {
  type: "object",
  properties: { line: { type: "string" }, emoji: { type: "string" }, mood: MOOD_FIELD, gesture: GESTURE_FIELD, layout: LAYOUT_FIELD, acting: ACTING_FIELD },
  required: ["line", "emoji", "mood", "gesture", "layout", "acting"],
  additionalProperties: false,
};
const STAMP_PART = {
  type: "object",
  properties: { text: { type: "string" }, emoji: { type: "string" }, mood: MOOD_FIELD, gesture: GESTURE_FIELD, layout: LAYOUT_FIELD, acting: ACTING_FIELD, line: { type: "string" } },
  required: ["text", "emoji", "mood", "gesture", "layout", "acting", "line"],
  additionalProperties: false,
};
const beatsOf = (fields: Record<string, object>) => ({
  type: "array",
  items: {
    type: "object",
    properties: { label: { type: "string" }, emoji: { type: "string" }, ...fields, mood: MOOD_FIELD, gesture: GESTURE_FIELD, layout: LAYOUT_FIELD, acting: ACTING_FIELD, line: { type: "string" } },
    required: ["label", "emoji", ...Object.keys(fields), "mood", "gesture", "layout", "acting", "line"],
    additionalProperties: false,
  },
});
const GRAPHIC = {
  type: "object",
  properties: {
    style: { type: "string", enum: ["none", ...MOTION_STYLES] },
    title: { type: "string" },
    unit: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, detail: { type: "string" }, value: { type: "number" }, cue: { type: "string" } },
        required: ["label", "detail", "value", "cue"],
        additionalProperties: false,
      },
    },
  },
  required: ["style", "title", "unit", "items"],
  additionalProperties: false,
};
const VISUAL = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["page", "post", "clip", "broll", "picture", "upload", "graphic"] },
    url: { type: "string" },
    start: { type: "number" },
    play: { type: "number" },
    prompt: { type: "string" },
    graphic: GRAPHIC,
  },
  required: ["kind", "url", "start", "play", "prompt", "graphic"],
  additionalProperties: false,
};

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    note: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, choices: { type: "array", items: { type: "string" } } },
        required: ["question", "choices"],
        additionalProperties: false,
      },
    },
  },
  required: ["note", "questions"],
  additionalProperties: false,
};
const RESEARCH = [webSearch(), xSearch({ enable_image_understanding: true, enable_video_understanding: true })];

const THEME_FIELD = { type: "string", enum: THEME_IDS };
const PULL_REQUEST_SCHEMA = {
  type: "object",
  properties: {
    note: { type: "string" },
    theme: THEME_FIELD,
    hook: SPOKEN_PART,
    why: SPOKEN_PART,
    beats: beatsOf({ file: { type: "string" }, from: { type: "integer" }, to: { type: "integer" }, graphic: GRAPHIC }),
    verdict: STAMP_PART,
  },
  required: ["note", "theme", "hook", "why", "beats", "verdict"],
  additionalProperties: false,
};
const IDEA_SCHEMA = {
  type: "object",
  properties: { note: { type: "string" }, title: { type: "string" }, theme: THEME_FIELD, hook: SPOKEN_PART, beats: beatsOf({ visual: VISUAL }), closer: STAMP_PART },
  required: ["note", "title", "theme", "hook", "beats", "closer"],
  additionalProperties: false,
};

// A message to Grok: text, or text with pictures.
type Message = { role: "system" | "user"; content: string | Array<{ type: "input_text"; text: string } | { type: "input_image"; image: Blob; detail: "high" }> };
type Spoken = { line: string; emoji: string; mood: Mood; gesture?: Gesture; layout: Layout; acting?: string };
type Stamp = Spoken & { text: string };
type Graphic = { style: "none" | Motion["style"]; title: string; unit: string; items: Motion["items"] };
type Visual = { kind: "page" | "post" | "clip" | "broll" | "picture" | "upload" | "graphic"; url: string; start: number; play?: number; prompt: string; graphic?: Graphic };
type PullRequestScript = { note: string; hook: Spoken; why: Spoken; beats: Array<Spoken & { label: string; file: string; from: number; to: number; graphic?: Graphic }>; verdict: Stamp };
type IdeaScript = { note: string; title: string; hook: Spoken; beats: Array<Spoken & { label: string; visual: Visual }>; closer: Stamp };
// How Grok writes one kind of video: its instructions, the shape of its reply, the order it writes the fields in, the
// tools it can research with, and how a reply becomes segments. `found` has the sources Grok's searches turned up,
// once the reply is complete.
type Kind = {
  prompt: string;
  schema: object;
  order: string[];
  tools: Tool[];
  segments: (script: Record<string, unknown>, found?: Set<string>) => Segment[];
};

// Has Grok write the first script about the source, and reports each segment as soon as it's written. For an idea, Grok
// researches it first and asks what it can't find out, like who the video is for, and the script waits for the answers.
export async function writeScript(
  source: Source,
  presenter: string,
  personality: string,
  persona: Persona,
  on: ScriptEvents = {},
  signal?: AbortSignal,
  uploads = "",
  avoid: string[] = [],
): Promise<{ draft: Draft; note: string; questions: Question[]; cost: number }> {
  if ("pr" in source && !shownFiles(source.pr).shown.size) {
    throw new Error("This pull request has no diffs to explain: its files are binary, lockfiles, or too big for GitHub to show.");
  }
  const kind = kindOf(source);
  const sources = new Set<string>();
  if ("pr" in source) {
    const input: Message[] = [
      { role: "system", content: kind.prompt },
      { role: "user", content: withSources(describe(source.pr, source.ask, presenter, persona, avoid), await sourcesBrief()) },
    ];
    const reply = await converse(kind, input, undefined, sources, on, signal);
    const title = titleOf(source, reply.script);
    const draft = { source, title, personality, persona, look: presenter, theme: themeOf(reply.script, freshTheme(avoid, title)), segments: reply.segments, responseId: reply.responseId, sources: [...sources], edits: [] };
    return { draft, note: reply.script.note as string, questions: [], cost: reply.cost };
  }
  const asked = await ask(
    [
      { role: "system", content: kind.prompt },
      { role: "user", content: withSources(ideaBrief(source.idea, presenter, persona, uploads, avoid), await sourcesBrief()) },
    ],
    sources,
    on,
    signal,
  );
  const waiting: Draft = { source, title: source.idea, personality, persona, look: presenter, theme: freshTheme(avoid, source.idea), segments: [], responseId: asked.responseId, sources: [...sources], edits: [] };
  if (asked.questions.length) {
    on.questions?.(asked.questions);
    return { draft: waiting, note: asked.note, questions: asked.questions, cost: asked.cost };
  }
  const written = await reviseScript(waiting, "Go ahead.", personality, persona, on, signal);
  return { ...written, questions: [], cost: asked.cost + written.cost };
}

// Has Grok change the script the way the person asks, carrying on the conversation from Grok's last reply, or write it,
// if the message answers Grok's questions. A new personality, and anything changed by hand since, go along with it, and
// so do `pictures`, like frames of the video the message is about. Grok keeps a conversation for a while, not forever,
// and a video made before the app saved conversations has none, so then a new one starts from what the video is about
// and its script as it is now.
export async function reviseScript(
  draft: Draft,
  message: string,
  personality: string,
  persona: Persona,
  on: ScriptEvents = {},
  signal?: AbortSignal,
  pictures: Blob[] = [],
): Promise<{ draft: Draft; note: string; cost: number }> {
  const changed = personality === draft.personality ? "" : `The presenter has a new personality, so write every line again in it.\n${personaLines(persona)}\n\n`;
  const edited = draft.edits.length ? `I changed this by hand: ${draft.edits.join(" ")}\n\n` : "";
  const write = draft.segments.length ? "" : "\n\nNow write the script.";
  const text = `${changed}${edited}${message}${write}`;
  const asked: Message = { role: "user", content: pictures.length ? [{ type: "input_text", text }, ...pictures.map((image) => ({ type: "input_image" as const, image, detail: "high" as const }))] : text };
  const kind = kindOf(draft.source);
  const sources = new Set(draft.sources);
  const anew = () => converse(kind, [{ role: "system", content: kind.prompt }, { role: "user", content: resumeBrief(draft) }, asked], undefined, sources, on, signal);
  const reply = !draft.responseId
    ? await anew()
    : await converse(kind, [asked], draft.responseId, sources, on, signal).catch((error) => {
        if (error instanceof NotFoundError) return anew();
        throw error;
      });
  // Grok doesn't know about trims, so a segment that says the same line keeps the one it had.
  const segments = reply.segments.map((segment) => ({ ...segment, trim: draft.segments.find((old) => old.line === segment.line)?.trim }));
  const revised = { ...draft, title: titleOf(draft.source, reply.script), personality, persona, theme: themeOf(reply.script, draft.theme), segments, responseId: reply.responseId, sources: [...sources], edits: [] };
  return { draft: revised, note: reply.script.note as string, cost: reply.cost };
}

// Trims a segment's take on the timeline, by hand, which only changes how much of it the cut uses, so nothing is filmed
// again. Each end can lose up to 3 seconds more than the app cut, or keep up to 1 more.
export function setTrim(draft: Draft, index: number, head: number, tail: number): Draft {
  const segment = draft.segments[index];
  if (!segment) throw new Error("There's no such segment.");
  const bound = (value: number) => Math.round(Math.min(3, Math.max(-1, Number(value) || 0)) * 100) / 100;
  const trim = { head: bound(head), tail: bound(tail) };
  return { ...draft, segments: draft.segments.with(index, { ...segment, trim: trim.head || trim.tail ? trim : undefined }) };
}

// Moves a beat to another place between the hook and the ending, by hand, dragged on the timeline.
export function moveSegmentTo(draft: Draft, from: number, to: number): Draft {
  const segment = draft.segments[from];
  const target = draft.segments[to];
  if (!segment || !target || segment.kind !== "beat" || target.kind !== "beat") throw new Error("Only beats can move, and only between the hook and the ending.");
  const segments = draft.segments.toSpliced(from, 1).toSpliced(to, 0, segment);
  return { ...draft, segments, edits: [...draft.edits, `I moved "${segment.label}" to be segment ${to + 1}.`] };
}

// Changes how a segment is framed by hand, without asking Grok, and notes the change for Grok's next reply.
export function setLayout(draft: Draft, index: number, layout: Layout): Draft {
  const segment = draft.segments[index];
  if (!segment || !LAYOUTS.includes(layout)) throw new Error("There's no such segment or layout.");
  const framed = layoutFor(layout, segment.screen);
  const segments = draft.segments.with(index, { ...segment, layout: framed });
  const edits = [...draft.edits.filter((edit) => !edit.startsWith(`Segment ${index + 1} `)), `Segment ${index + 1} ("${segment.label}") uses the ${framed} layout.`];
  return { ...draft, segments, edits };
}

export type Hook = { line: string; angle: string; score: number; why: string };

const HOOK_LAB = `You write hooks for short vertical videos: the line said in the first three seconds, which decides whether anyone keeps watching. Write four new hooks for this video, each from a different angle, like a surprising number, a bold claim the video backs up, a question it answers, a concrete symptom, or the first beat of a story. Each one says what the video is about and why anyone should care, in plain words, in the presenter's personality, in at most 20 words, and leads into the rest of the script as it is. Keep to the facts the script states. Then score every hook, the one the video has and yours, from 1 to 10 for how likely it is to stop someone scrolling, and say why in one short sentence. Be a tough critic: a 9 or a 10 is rare. The angle is two to four words.`;

const SCORED = { type: "object", properties: { score: { type: "integer" }, why: { type: "string" } }, required: ["score", "why"], additionalProperties: false };
const HOOKS_SCHEMA = {
  type: "object",
  properties: {
    current: SCORED,
    hooks: {
      type: "array",
      items: { type: "object", properties: { line: { type: "string" }, angle: { type: "string" }, score: { type: "integer" }, why: { type: "string" } }, required: ["line", "angle", "score", "why"], additionalProperties: false },
    },
  },
  required: ["current", "hooks"],
  additionalProperties: false,
};

// The hook lab: Grok writes four other hooks for the script, each from a different angle and in the presenter's
// personality, and scores them and the hook it has from 1 to 10 for how likely each is to stop someone scrolling.
export async function hookOptions(draft: Draft, signal?: AbortSignal): Promise<{ current: { score: number; why: string }; hooks: Hook[]; cost: number }> {
  const hook = draft.segments.find((segment) => segment.kind === "hook");
  if (!hook) throw new Error("This script has no hook yet.");
  const rest = draft.segments.filter((segment) => segment.kind !== "hook").map((segment) => `- ${segment.label}: ${segment.line}`);
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: HOOK_LAB },
        { role: "user", content: `${personaLines(draft.persona)}\n\nThe video: ${draft.title}\nThe hook it has: "${hook.line}"\nThe rest of the script:\n${rest.join("\n")}` },
      ],
      text: { format: { type: "json_schema", name: "hooks", schema: HOOKS_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const reply = response.toJson() as { current: { score: number; why: string }; hooks: Hook[] };
  const hooks = reply.hooks.filter((each) => each.line.trim()).slice(0, 4).map((each) => ({ ...each, line: each.line.trim(), score: Math.min(10, Math.max(1, Math.round(each.score))) }));
  return { current: reply.current, hooks: hooks.sort((a, b) => b.score - a.score), cost: response.usage.cost_usd ?? 0 };
}

// Where a video is posted, with how that platform shows what goes with it.
export const PLATFORMS = {
  shorts: "YouTube Shorts, which shows the title on the video and in search, so it's up to 100 characters and says what the video is about, with the description under it",
  tiktok: "TikTok, where the description is the caption over the bottom of the video, so its first line hooks, and the title is short",
  reels: "Instagram Reels, where the caption shows its first line over the video and the rest when tapped, so the first line hooks",
} as const;
export type Platform = keyof typeof PLATFORMS;

const PUBLISHING = `You write what goes with a short vertical video when it's posted: a title, a description, and hashtags, for the platform named. The description is one to three short sentences, the hashtags are three to six, without the #, specific to what the video's about, with at most one broad one. Keep to the facts the script states, and sound like the video does, in the presenter's personality.`;
const PUBLISHING_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, description: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } },
  required: ["title", "description", "hashtags"],
  additionalProperties: false,
};

// What goes with the video when it's posted on `platform`, written by Grok from its script.
export async function publishText(draft: Draft, platform: Platform, signal?: AbortSignal): Promise<{ title: string; description: string; hashtags: string[]; cost: number }> {
  const lines = draft.segments.map((segment) => `- ${segment.label}: ${segment.line}`);
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: PUBLISHING },
        { role: "user", content: `${personaLines(draft.persona)}\n\nThe platform: ${PLATFORMS[platform]}\nThe video: ${draft.title}\nIts script:\n${lines.join("\n")}` },
      ],
      text: { format: { type: "json_schema", name: "publishing", schema: PUBLISHING_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const reply = response.toJson() as { title: string; description: string; hashtags: string[] };
  const hashtags = reply.hashtags.map((tag) => tag.trim().replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 6);
  // A clip that plays with its own sound is someone else's video, so the description credits where it came from.
  const credits = [...new Set(draft.segments.flatMap(({ screen }) => (screen.kind === "clip" && screen.play ? [sourceLabel(screen.url)] : [])))];
  const credit = credits.length ? `\n\n${credits.length > 1 ? "Clips" : "Clip"} from ${credits.join(", ")}` : "";
  return { title: reply.title.trim(), description: `${reply.description.trim()}${credit}`, hashtags, cost: response.usage.cost_usd ?? 0 };
}

// Changes what a segment says by hand, without asking Grok, and notes the change for Grok's next reply, which keeps it.
export function setLine(draft: Draft, index: number, line: string): Draft {
  const segment = draft.segments[index];
  if (!segment || !line.trim()) throw new Error("There's no such segment, or the line is empty.");
  const segments = draft.segments.with(index, { ...segment, line: line.trim() });
  const note = `Segment ${index + 1} ("${segment.label}") now says: "${line.trim()}"`;
  return { ...draft, segments, edits: [...draft.edits.filter((edit) => !edit.startsWith(`Segment ${index + 1} ("${segment.label}") now says`)), note] };
}

// Shows one of the creator's uploads on a segment by hand, in place of what Grok chose, and notes the change for Grok's
// next reply, which keeps it. The hook and the ending are words on screen, with nothing else to show.
export function setUpload(draft: Draft, index: number, asset: { id: string; name: string }): Draft {
  const segment = draft.segments[index];
  if (!segment || segment.kind === "hook" || segment.kind === "ending") throw new Error("The hook and the ending are words on screen, so they can't show an upload.");
  const layout = segment.layout === "full" ? "overlay" : segment.layout;
  const segments = draft.segments.with(index, { ...segment, layout, screen: { kind: "upload", asset: asset.id, prompt: asset.name } });
  const note = `Segment ${index + 1} ("${segment.label}") shows my upload "${asset.name}" (${asset.id}).`;
  return { ...draft, segments, edits: [...draft.edits.filter((edit) => !edit.startsWith(`Segment ${index + 1} ("${segment.label}") shows my upload`)), note] };
}

// Changes the music and sound effects by hand. Grok doesn't hear about it: it's mixed in after filming, so changing it
// costs nothing.
export function setSound(draft: Draft, { music, volume, effects }: Partial<Sound>): Draft {
  const sound = { ...DEFAULT_SOUND, ...draft.sound };
  return { ...draft, sound: { music: music === undefined ? sound.music : music || undefined, volume: Math.min(Math.max(volume ?? sound.volume, 0), 1), effects: effects ?? sound.effects } };
}

// Cuts a beat, or the why of a pull request, by hand. The hook and the ending stay.
export function removeSegment(draft: Draft, index: number): Draft {
  const segment = draft.segments[index];
  if (!segment || segment.kind === "hook" || segment.kind === "ending") throw new Error("The hook and the ending can't be cut.");
  if (draft.segments.filter((each) => each.kind === "beat").length <= 1 && segment.kind === "beat") throw new Error("A video needs at least one beat.");
  return { ...draft, segments: draft.segments.toSpliced(index, 1), edits: [...draft.edits, `I cut the segment "${segment.label}".`] };
}

// Moves a beat one place earlier or later by hand, between the hook and the ending.
export function moveSegment(draft: Draft, index: number, by: -1 | 1): Draft {
  const [segment, other] = [draft.segments[index], draft.segments[index + by]];
  if (!segment || !other || segment.kind !== "beat" || other.kind !== "beat") throw new Error("Only beats can move, and only between the hook and the ending.");
  const segments = draft.segments.with(index, other).with(index + by, segment);
  return { ...draft, segments, edits: [...draft.edits, `I moved "${segment.label}" ${by < 0 ? "before" : "after"} "${other.label}".`] };
}

// Changes the theme by hand, without asking Grok, and notes the change for Grok's next reply. "brand" is the brand kit's
// theme, which Grok can't pick, so a video in it stays in it until it's changed by hand.
export function setTheme(draft: Draft, theme: ThemeId): Draft {
  if (theme !== "brand" && !THEME_IDS.includes(theme)) throw new Error("There's no such theme.");
  const note = theme === "brand" ? "The theme is the creator's own brand, so keep the theme as it is." : `The theme is ${theme}.`;
  return { ...draft, theme, edits: [...draft.edits.filter((edit) => !edit.startsWith("The theme ")), note] };
}

function themeOf(script: Record<string, unknown>, fallback: ThemeId): ThemeId {
  if (fallback === "brand") return fallback;
  return THEME_IDS.includes(script.theme as (typeof THEME_IDS)[number]) ? (script.theme as ThemeId) : fallback;
}

// Everything Grok needs to carry on with a video in a new conversation: what it's about, as Grok was first told, and the
// script as it is now, in the shape Grok writes it.
function resumeBrief(draft: Draft): string {
  const about =
    "pr" in draft.source
      ? describe(draft.source.pr, draft.source.ask, draft.look, draft.persona)
      : `The presenter is ${draft.look}.\n${personaLines(draft.persona)}\nThe personality was written for videos about code. Keep its voice, whatever the video is about.\n\nThe video I want: ${draft.source.idea}`;
  return `${about}\n\nWe already made this video together. Here's its script as it is now:\n${JSON.stringify(toScript(draft), null, 2)}`;
}

function toScript(draft: Draft): Record<string, unknown> {
  const spoken = ({ emoji, mood, gesture, layout, acting, line }: Segment) => ({ emoji, mood, gesture: gesture ?? "none", layout, acting, line });
  const find = (kind: Segment["kind"]) => draft.segments.find((segment) => segment.kind === kind);
  const [hook, why, ending] = [find("hook"), find("why"), find("ending")];
  const beats = draft.segments.filter((segment) => segment.kind === "beat");
  const stamp = ending && { text: ending.screen.kind === "stamp" ? ending.screen.text : ending.label, ...spoken(ending) };
  if ("pr" in draft.source) {
    const rows = (screen: Screen) => (screen.kind === "code" ? { file: screen.file, from: screen.from, to: screen.to } : { file: "", from: 0, to: 0 });
    return { theme: draft.theme, hook: hook && spoken(hook), why: why && spoken(why), beats: beats.map((beat) => ({ label: beat.label, ...rows(beat.screen), graphic: graphicFor(beat.screen), ...spoken(beat) })), verdict: stamp };
  }
  return { title: draft.title, theme: draft.theme, hook: hook && spoken(hook), beats: beats.map((beat) => ({ label: beat.label, visual: visualOf(beat.screen), ...spoken(beat) })), closer: stamp };
}

function visualOf(screen: Screen): Visual {
  const graphic = graphicFor(screen);
  if (screen.kind === "page" || screen.kind === "post") return { kind: screen.kind, url: screen.url, start: 0, play: 0, prompt: screen.prompt, graphic };
  if (screen.kind === "clip") return { kind: "clip", url: screen.url, start: screen.start, play: screen.play ?? 0, prompt: screen.prompt, graphic };
  if (screen.kind === "picture" || screen.kind === "broll") return { kind: screen.kind, url: "", start: 0, play: 0, prompt: screen.prompt, graphic };
  if (screen.kind === "upload") return { kind: "upload", url: screen.asset, start: 0, play: 0, prompt: screen.prompt, graphic };
  if (screen.kind === "motion") return { kind: "graphic", url: "", start: 0, play: 0, prompt: "", graphic };
  return { kind: "picture", url: "", start: 0, play: 0, prompt: "", graphic };
}

function graphicFor(screen: Screen): Graphic {
  return screen.kind === "motion" ? screen.motion : NO_GRAPHIC;
}

// Streams Grok's reply as structured output, and reports the note and each segment as soon as they're complete, so the
// page shows them while Grok writes the rest. The reply is stored, so the next message can carry on from it. Every page,
// post, and video that Grok's searches turn up goes in `sources`, and a reply can only show those.
async function converse(
  kind: Kind,
  input: Message[],
  previous: string | undefined,
  sources: Set<string>,
  on: ScriptEvents,
  signal?: AbortSignal,
): Promise<{ script: Record<string, unknown>; segments: Segment[]; responseId: string; cost: number }> {
  let noted = false;
  let sent = 0;
  const report = (partial: Record<string, unknown>) => {
    const script = finished(partial, kind.order, false);
    if (!noted && typeof script.note === "string") {
      noted = true;
      on.note?.(script.note);
    }
    const segments = kind.segments(script);
    for (; sent < segments.length; sent++) on.segment?.(segments[sent], sent);
  };
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input,
      previous_response_id: previous,
      store: true,
      tools: await toolsFor(kind.tools),
      text: { format: { type: "json_schema", name: "short_script", schema: kind.schema } },
      // At medium or high effort, Grok spent over three minutes and 12,000 reasoning tokens on a four-file pull request
      // before writing a word. At low effort the script starts within seconds.
      reasoning: { effort: "low" },
      stream: true,
    },
    { signal },
  );
  const response = await listen(stream, sources, on)
    .on("json", (value) => report(value as Record<string, unknown>))
    .done();
  const script = response.toJson() as Record<string, unknown>;
  if (!noted) on.note?.(String(script.note ?? ""));
  const segments = kind.segments(finished(script, kind.order, true), sources);
  for (; sent < segments.length; sent++) on.segment?.(segments[sent], sent);
  if (!segments.some((segment) => segment.kind === "beat")) throw new Error("Grok's script didn't have any beats it could show.");
  return { script, segments, responseId: response.id, cost: response.usage.cost_usd ?? 0 };
}

// Has Grok research an idea, say what it understood, and ask what only the person can tell it, before any script is
// written. The reply is stored, so the script carries on from the research.
async function ask(input: Array<{ role: string; content: string }>, sources: Set<string>, on: ScriptEvents, signal?: AbortSignal): Promise<{ note: string; questions: Question[]; responseId: string; cost: number }> {
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input,
      store: true,
      tools: await toolsFor(RESEARCH),
      text: { format: { type: "json_schema", name: "questions", schema: QUESTIONS_SCHEMA } },
      reasoning: { effort: "low" },
      stream: true,
    },
    { signal },
  );
  const response = await listen(stream, sources, on).done();
  const { note, questions } = response.toJson() as { note: string; questions: Question[] };
  on.note?.(note);
  const asked = questions.filter((question) => question.question.trim()).slice(0, 3);
  return { note, questions: asked, responseId: response.id, cost: response.usage.cost_usd ?? 0 };
}

// Follows a reply's thinking and research as it streams: what Grok searched for, and every page, post, and video its
// searches turned up, which are the only ones a beat can show.
function listen(stream: ResponseStream, sources: Set<string>, on: ScriptEvents): ResponseStream {
  return stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("server_tool_call", (call) => noteSearch(call, sources, on))
    .on("citation", (citation) => {
      if (citation.url) sources.add(sourceKey(citation.url));
    });
}

// The tools a request gets: `tools`, and a tool for each connected source that's turned on.
async function toolsFor(tools: Tool[]): Promise<Tool[] | undefined> {
  const all = [...tools, ...(await sourceTools())];
  return all.length ? all : undefined;
}

// Reports what Grok searched for, or read from a connected source, and keeps every page a web search found.
function noteSearch(call: ServerToolCall, sources: Set<string>, on: ScriptEvents): void {
  if (call.type === "mcp_call") {
    const { server_label: label, name } = call as { server_label?: string; name?: string };
    if (label && name) on.research?.(label, name.replaceAll("_", " "));
  }
  if (call.type === "web_search_call") {
    const { action } = call as { action?: { query?: string; sources?: Array<{ url?: string }> } };
    for (const found of action?.sources ?? []) if (found.url) sources.add(sourceKey(found.url));
    if (action?.query) on.research?.("web", action.query);
  }
  if (call.type === "custom_tool_call" && call.name.startsWith("x_")) {
    const query = queryOf(call.input);
    if (query) on.research?.("x", query);
  }
}

// An X search's arguments arrive as a JSON string.
function queryOf(input: string | undefined): string | undefined {
  try {
    return (JSON.parse(input ?? "") as { query?: string }).query;
  } catch {
    return undefined;
  }
}

// One key per page, post, or video, however its URL is written: an X post by its ID, a YouTube video by its ID, and
// anything else by its host and path.
export function sourceKey(url: string): string {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    const host = hostname.replace(/^(www|m|mobile)\./, "");
    const post = pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
    if ((host === "x.com" || host === "twitter.com") && post) return `x:${post}`;
    if (host === "youtu.be") return `youtube:${pathname.slice(1)}`;
    if (host.endsWith("youtube.com")) return `youtube:${searchParams.get("v") ?? pathname.split("/").pop()}`;
    return `${host}${pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

// The parts of a reply that Grok has finished writing. Grok writes the fields in order, so a field is finished once the
// next one starts, and each beat once the next beat starts. `done` says the whole reply is in.
function finished(partial: Record<string, unknown>, order: string[], done: boolean): Record<string, unknown> {
  const script: Record<string, unknown> = {};
  order.forEach((key, index) => {
    const value = partial[key];
    if (value === undefined) return;
    const next = done || order.slice(index + 1).some((later) => partial[later] !== undefined);
    if (Array.isArray(value)) script[key] = next ? value : value.slice(0, -1);
    else if (next) script[key] = value;
  });
  return script;
}

// The segments of a script in the shape Grok writes it, like one an earlier version of the app saved instead of segments.
export function segmentsOf(source: Source, script: Record<string, unknown>): Segment[] {
  return kindOf(source).segments(script);
}

function kindOf(source: Source): Kind {
  if ("pr" in source) {
    const { shown } = shownFiles(source.pr);
    return {
      prompt: PULL_REQUEST_PROMPT,
      schema: PULL_REQUEST_SCHEMA,
      order: ["note", "theme", "hook", "why", "beats", "verdict"],
      tools: [],
      segments: (script) => pullRequestSegments(script as Partial<PullRequestScript>, shown),
    };
  }
  return {
    prompt: IDEA_PROMPT,
    schema: IDEA_SCHEMA,
    order: ["note", "title", "theme", "hook", "beats", "closer"],
    tools: RESEARCH,
    segments: (script, found) => ideaSegments(script as Partial<IdeaScript>, found),
  };
}

function titleOf(source: Source, script: Record<string, unknown>): string {
  if ("pr" in source) return source.pr.title;
  return typeof script.title === "string" && script.title.trim() ? script.title.trim() : source.idea;
}

// Grok can only point at files whose diffs it was shown, and at rows that exist. A beat for any other file is dropped,
// and row numbers outside the diff are pulled back inside it.
function pullRequestSegments(script: Partial<PullRequestScript>, shown: Map<string, ChangedFile>): Segment[] {
  const segments: Segment[] = [];
  if (script.hook) segments.push(segment("hook", "Hook", script.hook, { kind: "headline" }));
  if (script.why) segments.push(segment("why", "Why it matters", script.why, { kind: "pull-request" }));
  for (const beat of script.beats ?? []) {
    const motion = graphicOf(beat.graphic);
    if (motion && beat.line.trim()) segments.push(segment("beat", beat.label, beat, { kind: "motion", motion }));
    const file = shown.get(beat.file);
    if (motion || !file || !beat.line.trim()) continue;
    const clamp = (row: number) => Math.min(Math.max(Math.round(row), 1), file.rows.length);
    const [from, to] = [clamp(Math.min(beat.from, beat.to)), clamp(Math.max(beat.from, beat.to))];
    segments.push(segment("beat", beat.label, beat, { kind: "code", file: beat.file, from, to }));
  }
  const { verdict } = script;
  if (verdict) segments.push(segment("ending", `Verdict: ${verdict.text}`, verdict, { kind: "stamp", text: verdict.text }));
  return varied(segments);
}

function ideaSegments(script: Partial<IdeaScript>, found?: Set<string>): Segment[] {
  const segments: Segment[] = [];
  if (script.hook) segments.push(segment("hook", "Hook", script.hook, { kind: "headline" }));
  let stitches = 0;
  for (const beat of script.beats ?? []) {
    if (!beat.line.trim()) continue;
    const screen = visualScreen(beat.visual, found);
    // Two clips playing with their own sound is plenty for a short, so any more play under the line, like the rest.
    const played = screen.kind === "clip" && screen.play && ++stitches > 2 ? { ...screen, play: undefined } : screen;
    segments.push(segment("beat", beat.label, beat, played));
  }
  const { closer } = script;
  if (closer) segments.push(segment("ending", closer.text, closer, { kind: "stamp", text: closer.text }));
  return varied(segments);
}

function segment(kind: Segment["kind"], label: string, { line, emoji, mood, gesture, layout, acting }: Spoken, screen: Screen): Segment {
  const framed = layoutFor(layout, screen);
  const picked = GESTURES.includes(gesture as Gesture) ? (gesture as Gesture) : "none";
  return { kind, label, emoji, mood, gesture: picked === "point" && !showsAbove(framed) ? "none" : picked, line: line.trim(), screen, layout: framed, acting: acting?.trim() ?? "" };
}

// Real people don't make the same move twice in a row, and pointing at the screen gets old fast, so a gesture that repeats
// the one before it, or a third point, becomes none.
function varied(segments: Segment[]): Segment[] {
  let points = 0;
  return segments.map((each, index) => {
    const repeat = each.gesture !== "none" && each.gesture === segments[index - 1]?.gesture;
    const pointed = each.gesture === "point" && ++points > 2;
    return repeat || pointed ? { ...each, gesture: "none" } : each;
  });
}

// Whether the presenter has something shown above them to point at: the card in a split, or a visual laid over their video.
export function showsAbove(layout: Layout): boolean {
  return layout === "split" || layout === "overlay";
}

// The hook and the ending are words on screen, with nothing to put the presenter in front of, so they go in a split or
// full screen. Above the presenter's head there's only room for a graphic of a few items, so a bigger one goes in a split.
function layoutFor(layout: Layout, screen: Screen): Layout {
  const chosen = LAYOUTS.includes(layout) ? layout : "split";
  if (screen.kind === "headline" || screen.kind === "stamp") return chosen === "split" ? "split" : "full";
  if (screen.kind === "motion" && chosen === "overlay" && (screen.motion.style === "hub" || screen.motion.items.length > 3)) return "split";
  return chosen;
}

// A beat can only show a page, post, or video that Grok's searches turned up, never a URL it made up. Once the reply is
// complete and `found` is known, anything else becomes the picture Grok described in its place. A YouTube video always
// plays as a clip, since a screenshot of its page only catches the page loading, and an X post is shown as a post unless
// it's asked for as a clip.
function visualScreen({ kind, url, start, play, prompt, graphic }: Visual, found?: Set<string>): Screen {
  const picture = { kind: "picture" as const, prompt: prompt.trim() };
  const motion = kind === "graphic" ? graphicOf(graphic) : undefined;
  if (motion) return { kind: "motion", motion };
  if (kind === "picture" || kind === "graphic") return picture;
  if (kind === "broll") return { kind: "broll", prompt: prompt.trim() };
  if (kind === "upload") return /^upload-[0-9a-f]+$/.test(url.trim()) ? { kind: "upload", asset: url.trim(), prompt: prompt.trim() } : picture;
  const key = sourceKey(url);
  if (!url.trim() || (found && !found.has(key))) return picture;
  const stitch = kind === "clip" ? Math.round(Math.min(8, Math.max(0, play || 0))) : 0;
  if (kind === "clip" || key.startsWith("youtube:")) return { kind: "clip", url, start: kind === "clip" ? Math.max(0, start || 0) : 0, prompt: picture.prompt, ...(stitch >= 3 ? { play: stitch } : {}) };
  return { kind: key.startsWith("x:") ? "post" : "page", url, prompt: picture.prompt };
}

// The graphic Grok wrote, or nothing if it's none or has too few items to draw. A number takes only its first item, and
// the rest five at most, or six for a hub with its center.
function graphicOf(graphic: Graphic | undefined): Motion | undefined {
  const style = MOTION_STYLES.find((each) => each === graphic?.style);
  if (!graphic || !style) return undefined;
  const items = (graphic.items ?? [])
    .filter((item) => item.label?.trim())
    .slice(0, style === "stat" ? 1 : style === "hub" ? 6 : 5)
    .map((item) => ({ label: item.label.trim(), detail: item.detail?.trim() ?? "", value: Number.isFinite(item.value) ? item.value : 0, cue: item.cue?.trim() ?? "" }));
  if (items.length < (style === "stat" ? 1 : 2)) return undefined;
  return { style, title: graphic.title?.trim() ?? "", unit: graphic.unit?.trim() ?? "", items };
}

const NO_GRAPHIC: Graphic = { style: "none", title: "", unit: "", items: [] };

function personaLines(persona: Persona): string {
  return `Their personality is "${persona.name}": ${persona.summary}
How they talk: ${persona.style}
If this personality comes from a real person's posts, borrow the style only: never use that person's name or handle, and never speak as them.`;
}

// A brief, with what Grok can read from the connected sources after it.
function withSources(brief: string, reading: string): string {
  return reading ? `${brief}\n\n${reading}` : brief;
}

// The themes my last few videos were in, so this one looks different from them.
function variety(avoid: string[]): string {
  if (!avoid.length) return "";
  const named = avoid.map((id) => THEMES[id as keyof typeof THEMES]?.name ?? id);
  return `\n\nMy last videos were in the ${named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0]} themes, so pick a different theme for this one, unless I ask for one of those.`;
}

function ideaBrief(idea: string, presenter: string, persona: Persona, uploads = "", avoid: string[] = []): string {
  return `The presenter is ${presenter}.
${personaLines(persona)}
The personality was written for videos about code. Keep its voice, whatever the video is about.

Unless I ask for another length, write at most ${IDEA_WORDS} words in all the lines together.${variety(avoid)}

The video I want: ${idea}
${uploads ? `\n${uploads}\n` : ""}
Before you write the script, research it: search the web for the official pages, docs, and launch posts of each product, company, or person it's about, and X for posts with screenshots or videos of them. Then tell me in the note what you understood the video to be, and ask me what you still need to know: up to three short questions about things only I can tell you, like who it's for, the point I want it to make, or what I want shown, each with two to four likely answers. Don't ask about anything you could look up. If you have what you need, ask nothing.`;
}

// The files Grok gets to see the diffs of. Lockfiles and minified files are listed without their diffs, and so is
// everything past the first MAX_DIFF_CHARACTERS of diff.
function shownFiles(pr: PullRequest): { shown: Map<string, ChangedFile>; list: string[]; diffs: string[] } {
  const shown = new Map<string, ChangedFile>();
  const list: string[] = [];
  const diffs: string[] = [];
  let budget = MAX_DIFF_CHARACTERS;
  for (const file of pr.files) {
    const label = `${file.path} (${file.status}, +${file.additions} -${file.deletions})`;
    const diff = file.rows.map((row, index) => `${index + 1} ${patchLine(row)}`).join("\n");
    const skipped = !file.rows.length ? "no diff to show" : SKIPPED.test(file.path) ? "a lockfile or minified file" : diff.length > budget ? "diff left out, the pull request is too big" : "";
    list.push(skipped ? `- ${label}: ${skipped}` : `- ${label}`);
    if (skipped) continue;
    budget -= diff.length;
    shown.set(file.path, file);
    diffs.push(`### ${file.path}\n${diff}`);
  }
  if (pr.changedFiles > pr.files.length) list.push(`- and ${pr.changedFiles - pr.files.length} more files`);
  return { shown, list, diffs };
}

// Everything Grok gets to read about a pull request: its description and commits, then each file's diff with its rows
// numbered, so the script can say which rows to highlight.
function describe(pr: PullRequest, ask: string | undefined, presenter: string, persona: Persona, avoid: string[] = []): string {
  const { list, diffs } = shownFiles(pr);
  const words = Math.round(Math.min(MAX_WORDS, Math.max(MIN_WORDS, 75 + (pr.additions + pr.deletions) / 5)));
  return `The presenter is ${presenter}.
${personaLines(persona)}

Unless I ask for another length, write at most ${words} words in all the lines together.${variety(avoid)}${ask ? `\n\nWhat I'd like from the video: ${ask}` : ""}

Pull request #${pr.number} in ${pr.repo}: ${pr.title}
By ${pr.author}, merging ${pr.head} into ${pr.base}. ${pr.changedFiles} files changed, +${pr.additions} -${pr.deletions}.

Description:
${pr.description || "(none)"}

Commits:
${pr.commits.map((message) => `- ${message}`).join("\n")}

Changed files:
${list.join("\n")}

Diffs, with each file's rows numbered:

${diffs.join("\n\n")}`;
}

function patchLine(row: Row): string {
  const line = row.kind === "hunk" ? row.text : `${{ add: "+", del: "-", same: " " }[row.kind]}${row.text}`;
  return line.length > MAX_ROW_CHARACTERS ? `${line.slice(0, MAX_ROW_CHARACTERS)}…` : line;
}
