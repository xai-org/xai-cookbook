import { basename, resolve } from "node:path";
import { loadBrand } from "./brand.ts";
import type { PullRequest } from "./github.ts";
import { assetsBrief, listAssets } from "./library.ts";
import { listPersonalities } from "./persona.ts";
import { findPresenter, listPresenters, personalityOf } from "./presenter.ts";
import { type Project, type Turn, archiveCurrent, cutsOf, keepCut, loadProject, newProject, recentThemes, saveProject } from "./project.ts";
import { PLATFORMS, type Platform, type Question, type Segment, publishText } from "./script.ts";
import { type FilmEvents, type Stage, type WriteEvents, estimateDraft, filmDraft, newCache, reviseDraft, startDraft } from "./short.ts";
import { TAKES_PER_LINE } from "./takes.ts";

// Grok Shorts as one function for each step of making a video, for scripts and agents. Each step opens the video's
// project in output/ and saves it again, the same way the web app does, so a video started here can be finished in the
// studio, or the other way around. Steps that take a while say what they're doing to `onProgress`, in plain words.

export type Progress = (message: string) => void;
type Steps = { onProgress?: Progress; signal?: AbortSignal };

// A video and its latest script. `project` is the name to pass to the next step, the video's folder in output/. Grok's
// questions are there while it waits for answers before writing, with no segments yet. Each segment says how long its
// take runs and whether it's filmed already, `estimate` says what filming the rest would cost, and `versions` has every
// cut, previews included, oldest first, with the current one marked. `cost` is what the step that returned it cost.
export type Video = {
  project: string;
  folder: string;
  title: string;
  about: string;
  presenter: string;
  personality: string;
  theme: string;
  note?: string;
  questions?: Question[];
  segments: Array<Pick<Segment, "label" | "emoji" | "line" | "mood" | "layout" | "screen"> & { acting?: string; seconds?: number; filmed?: boolean }>;
  estimate?: Estimate;
  versions: Version[];
  cost?: number;
};
// What filming the latest script costs now, in dollars, for the takes it still needs: takes kept from an earlier cut cost
// nothing. B-roll costs about as much as a take, a picture a few cents, and a line that gets cut off is filmed again,
// longer, so a film can cost a little more.
export type Estimate = { usd: number; seconds: number; newTakes: number };
export type Version = { version: number; preview: boolean; video: string; duration: number; cost: number; current: boolean };
// A cut just made, in a file that later cuts don't write over.
export type NewCut = { project: string; version: number; preview: boolean; video: string; duration: number; cost: number; transcript: string };
export type Caption = { project: string; platform: Platform; title: string; description: string; hashtags: string[]; cost: number };

// What Grok is told when nobody can answer its questions, the same as in a batch and in the terminal.
const GO_AHEAD = "I can't answer right now, so go with your best judgment.";
const WAITING = "Grok is waiting for answers to its questions. Answer them with revise first.";
const STAGES: Record<Stage, string> = {
  read: "Reading the pull request",
  persona: "Reading the account's posts to copy its style",
  write: "Writing the script",
  draw: "Drawing the presenter, unless an earlier video did",
  visuals: "Getting what each beat shows",
  film: "Filming the takes",
  edit: "Cutting the takes together and drawing every frame",
};

// The presenters and personalities a video can be made with, and the presenter a new video starts with: the brand kit's,
// if it has one.
export async function presenters() {
  const brand = await loadBrand();
  const cast = (await listPresenters()).map((presenter) => ({ id: presenter.id, name: presenter.name, personality: personalityOf(presenter), look: presenter.look, room: presenter.room }));
  const personalities = (await listPersonalities()).map(({ id, name, summary, custom }) => ({ id, name, summary, custom }));
  return { presenter: brand?.presenter ?? "maya", presenters: cast, personalities };
}

// Starts a video from a link to a pull request, or an idea, and has Grok write its script. For an idea, Grok may ask
// questions first, which come back with no segments: answer them with revise(), or pass `goAhead` for Grok to go with its
// best judgment. A pull request read some other way, like with an agent's own access to a private repository, comes as
// `pullRequest`, and then `source` says what to make of it. A new script for the same pull request or idea starts that
// video's conversation over.
export async function draft(
  source: string,
  { presenter, personality, pullRequest, goAhead = false, onProgress = () => {}, signal }: Steps & { presenter?: string; personality?: string; pullRequest?: PullRequest; goAhead?: boolean } = {},
): Promise<Video> {
  if (!source.trim() && !pullRequest) throw new Error("Give a link to a pull request, or an idea for a video.");
  const brand = await loadBrand();
  const cast = await findPresenter(presenter || brand?.presenter || "maya");
  const style = personality || personalityOf(cast);
  const uploads = assetsBrief(await listAssets());
  let asked: Question[] | undefined;
  const on = writeEvents(onProgress, style, (questions) => (asked = questions));
  let written = await startDraft(source, cast.id, style, on, signal, uploads, await recentThemes(), pullRequest);
  const history: Turn[] = [{ role: "user", text: pullRequest ? `${pullRequest.url} ${source}`.trim() : source }, { role: "grok", note: written.note, questions: asked }];
  let cost = written.cost;
  if (goAhead && !written.draft.segments.length) {
    asked = undefined;
    written = await reviseDraft(written.draft, GO_AHEAD, style, on, signal);
    history.push({ role: "user", text: GO_AHEAD }, { role: "grok", note: written.note, questions: asked });
    cost += written.cost;
  }
  // A new video starts in the brand kit's theme, if there's one, which stays until it's changed by hand.
  const project = await newProject(brand ? { ...written.draft, theme: "brand" } : written.draft, cast.id);
  project.history.push(...history);
  project.briefed = uploads;
  await saveProject(project);
  return { ...(await videoOf(project)), cost: money(cost) };
}

// Sends Grok a message about the video: answers to its questions, or what to change. Grok writes the whole script again,
// changed only as asked, so filming again only films the segments that changed. A new `personality` says the same
// things another way.
export async function revise(name: string, message: string, { personality, onProgress = () => {}, signal }: Steps & { personality?: string } = {}): Promise<Video> {
  if (!message.trim()) throw new Error("Write the answers to Grok's questions, or what to change.");
  const project = await loadProject(name);
  const style = personality || project.draft.personality;
  // Grok hears what's in the library again whenever it's changed since Grok was last told.
  const uploads = assetsBrief(await listAssets());
  const told = uploads && uploads !== project.briefed ? `${message}\n\n${uploads}` : message;
  let asked: Question[] | undefined;
  const written = await reviseDraft(project.draft, told, style, writeEvents(onProgress, style, (questions) => (asked = questions)), signal);
  project.draft = written.draft;
  project.briefed = uploads;
  project.history.push({ role: "user", text: message }, { role: "grok", note: written.note, questions: asked });
  await saveProject(project);
  return { ...(await videoOf(project)), cost: money(written.cost) };
}

// A video as it is now, without changing anything.
export async function show(name: string): Promise<Video> {
  return videoOf(await loadProject(name));
}

// What filming the latest script would cost now, with another presenter if `presenter` is given.
export async function estimate(name: string, { presenter }: { presenter?: string } = {}): Promise<Estimate & { project: string; presenter: string }> {
  const project = await loadProject(name);
  const who = presenter || project.presenter;
  const { segments, cost } = await estimateDraft(project.draft, who, newCache(project.choices), project.dir);
  return { project: basename(project.dir), presenter: who, ...totals(segments, cost) };
}

// A preview: the presenter's portrait, still, says each line with text to speech, drawn exactly like the real cut, for a
// fraction of a cent, plus a few cents for each picture it draws that an earlier one didn't. It's kept as a version to
// watch, but never becomes the video.
export function preview(name: string, options: Steps & { presenter?: string } = {}): Promise<NewCut> {
  return makeCut(name, true, options);
}

// Films the latest script and cuts it together. Takes of segments that haven't changed since an earlier cut are kept, so
// filming again only pays for what changed. With `maxUsd`, nothing is filmed when the estimate is over it. Takes that
// have started rendering are billed even if the step is stopped, since the API can't cancel a video.
export function film(name: string, { maxUsd, ...options }: Steps & { presenter?: string; maxUsd?: number } = {}): Promise<NewCut> {
  return makeCut(name, false, options, maxUsd);
}

// A title, a description, and hashtags to post the video with on YouTube Shorts (`shorts`), TikTok, or Reels, written
// from the script in the video's personality.
export async function caption(name: string, platform = "shorts"): Promise<Caption> {
  if (!(platform in PLATFORMS)) throw new Error(`Pick a platform: ${Object.keys(PLATFORMS).join(", ")}.`);
  const project = await loadProject(name);
  if (!project.draft.segments.length) throw new Error(WAITING);
  const { title, description, hashtags, cost } = await publishText(project.draft, platform as Platform);
  return { project: basename(project.dir), platform: platform as Platform, title, description, hashtags, cost: money(cost) };
}

async function makeCut(name: string, preview: boolean, { presenter, onProgress = () => {}, signal }: Steps & { presenter?: string }, maxUsd?: number): Promise<NewCut> {
  const project = await loadProject(name);
  const { draft } = project;
  if (!draft.segments.length) throw new Error(WAITING);
  const who = presenter || project.presenter;
  const cache = newCache(choicesOf(project));
  if (maxUsd !== undefined) {
    const { cost } = await estimateDraft(draft, who, cache, project.dir);
    if (cost > maxUsd) throw new Error(`Filming would cost about $${cost.toFixed(2)}, over the cap of $${maxUsd.toFixed(2)}, so nothing was filmed.`);
  }
  await archiveCurrent(project);
  const short = await filmDraft(draft, who, cache, filmEvents(onProgress, preview, draft.segments.length), signal, project.dir, { preview });
  const cost = short.cost.presenter + short.cost.media + short.cost.takes;
  project.presenter = who;
  const made = Date.now();
  const takes = short.takes.map((take) => take.file);
  const kept = await keepCut(project, { id: made, video: short.video, made, parts: short.parts, words: short.words, segments: draft.segments, title: draft.title, theme: draft.theme, onScreen: draft.onScreen, sound: draft.sound, cost, takes, ...(preview ? { kind: "preview" as const } : {}) });
  await saveProject(project);
  return { project: basename(project.dir), version: cutsOf(project).length, preview, video: resolve(kept.video), duration: tenths(short.duration), cost: money(cost), transcript: short.transcript };
}

// The takes a cut starts from: the ones picked by hand, and for each segment that hasn't changed since the current cut,
// the take that cut used, so filming again keeps the segment exactly as it was, even when another of its takes hears the
// line as well. A take is named after what it was filmed from, so a segment that changed has none of these.
function choicesOf(project: Project): Record<string, string> {
  const used = (project.cut?.takes ?? []).flatMap((file) => {
    const name = basename(file);
    const filmedFrom = name.match(/^take-([0-9a-f]{10})-[a-z]+\.mp4$/)?.[1];
    return filmedFrom ? [[filmedFrom, `${project.dir}/${name}`]] : [];
  });
  return { ...Object.fromEntries(used), ...project.choices };
}

async function videoOf(project: Project): Promise<Video> {
  const { draft } = project;
  const last = project.history.findLast((turn): turn is Extract<Turn, { role: "grok" }> => turn.role === "grok");
  // A video saved before it had a presenter can't say what its takes cost.
  const estimated = await estimateDraft(draft, project.presenter, newCache(project.choices), project.dir).catch(() => undefined);
  const current = project.cut && Math.round(project.cut.made);
  return {
    project: basename(project.dir),
    folder: resolve(project.dir),
    title: draft.title,
    about: "pr" in draft.source ? draft.source.pr.url : draft.source.idea,
    presenter: project.presenter,
    personality: draft.personality,
    theme: draft.theme,
    note: last?.note,
    questions: draft.segments.length ? undefined : last?.questions,
    segments: draft.segments.map(({ label, emoji, line, mood, layout, screen, acting }, index) => ({
      label,
      emoji,
      line,
      mood,
      layout,
      screen,
      ...(acting ? { acting } : {}),
      seconds: estimated?.segments[index].seconds,
      filmed: estimated?.segments[index].filmed,
    })),
    estimate: estimated && draft.segments.length ? totals(estimated.segments, estimated.cost) : undefined,
    versions: cutsOf(project).map((cut, index) => ({
      version: index + 1,
      preview: cut.kind === "preview",
      video: resolve(cut.video),
      duration: tenths(cut.parts.at(-1)?.end ?? 0),
      cost: money(cut.cost),
      current: Math.round(cut.made) === current,
    })),
  };
}

function totals(segments: Array<{ seconds: number; filmed: boolean }>, cost: number): Estimate {
  const seconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  return { usd: money(cost), seconds, newTakes: segments.filter((segment) => !segment.filmed).length * TAKES_PER_LINE };
}

function writeEvents(say: Progress, personality: string, questions: (asked: Question[]) => void): WriteEvents {
  return {
    // Only an X handle's personality takes time to work out.
    stage: (stage, status) => status === "active" && (stage !== "persona" || personality.startsWith("@")) && say(STAGES[stage]),
    pullRequest: ({ title, author, changedFiles, additions, deletions }) => say(`"${title}"${author ? ` by ${author}` : ""}: ${changedFiles} files, +${additions} -${deletions}`),
    research: (where, query) => say(`Searching ${where === "web" ? "the web" : where === "x" ? "X" : where}: ${query}`),
    questions,
  };
}

// Progress on the takes and the frames is said every 10%, so a log doesn't fill up with it.
function filmEvents(say: Progress, preview: boolean, segments: number): FilmEvents {
  const percents = Array<number>(segments).fill(0);
  const said = { takes: -1, frames: -1 };
  const every = (what: keyof typeof said, percent: number, label: string) => {
    const step = Math.floor(percent / 10) * 10;
    if (step <= said[what]) return;
    said[what] = step;
    say(`${label}: ${step}%`);
  };
  return {
    stage: (stage, status) => status === "active" && say(preview && stage === "film" ? "Saying each line with text to speech" : STAGES[stage]),
    notice: say,
    take: (index, update) => {
      percents[index] = update.status === "done" ? 100 : update.percent;
      every("takes", percents.reduce((sum, percent) => sum + percent, 0) / segments, preview ? "Lines" : "Takes");
    },
    progress: (frame, frames) => every("frames", (frame / frames) * 100, "Frames"),
  };
}

function money(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

function tenths(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
