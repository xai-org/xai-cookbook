import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { listBatches, startBatch, type Batch } from "./batches.ts";
import { type Brand, FONTS, loadBrand, removeLogo, saveBrand, saveLogo } from "./brand.ts";
import type { PullRequest } from "./github.ts";
import { type Asset, addAsset, assetsBrief, findAsset, listAssets, removeAsset, typeOf } from "./library.ts";
import { type Persona, inventPersonality, listPersonalities, parseHandle, personaFromX, sampleLines, savePersonality } from "./persona.ts";
import { drawPortraits, drawPresenter, findFace, findPresenter, listPresenters, personalityOf, savePresenter } from "./presenter.ts";
import { type Cut, type Note, type Project, type Turn, addNote, archiveCurrent, changesSince, cutsOf, keepCut, loadProject, newProject, notesMessage, recentThemes, restoreCut, saveProject } from "./project.ts";
import { reviewCut } from "./review.ts";
import { PRESETS, type Source, listSources, removeSource, saveSource, testSource } from "./sources.ts";
import {
  DEFAULT_SOUND,
  LAYOUTS,
  type Layout,
  PLATFORMS,
  type Platform,
  type Question,
  type Segment,
  hookOptions,
  moveSegmentTo,
  publishText,
  removeSegment,
  setLayout,
  setLine,
  setSound,
  setTheme,
  setTrim,
  setUpload,
} from "./script.ts";
import { type FilmEvents, type Stage, type WriteEvents, chooseTake, estimateDraft, filmDraft, newCache, previewVisuals, retakeSegment, reviseDraft, startDraft, takesOf, transcriptOf } from "./short.ts";
import { cloneVoice, inventPresenter, listVoices, newPresenterId, previewVoice, readVideo } from "./studio.ts";
import { TAKES_PER_LINE, TAKE_USD_PER_SECOND, filmLine, lineSeconds } from "./takes.ts";
import { THEMES, THEME_IDS, type ThemeId } from "./themes.ts";
import { brandFromWebsite } from "./website.ts";

// Grok Shorts as functions, one for everything the web app does, for scripts and agents. Each one opens what it works on
// from output/ and saves it again the same way the web app does, so a video started here can be finished in the studio,
// or the other way around. Segments and versions are numbered from 1, the way show() lists them. Steps that take a while
// say what they're doing to `onProgress`, in plain words.

const run = promisify(execFile);

export type Progress = (message: string) => void;
type Steps = { onProgress?: Progress; signal?: AbortSignal };

// A video and its latest script. `project` is the name every other function takes, the video's folder in output/.
// Grok's questions are there while it waits for answers before writing, with no segments yet. Each segment says how long
// its take runs and whether it's filmed already, `estimate` says what filming the rest would cost, and `versions` has
// every cut, previews included, oldest first, with the current one marked. Notes that haven't gone to Grok yet go with
// the next revise(). `cost` is what the step that returned it cost.
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
  segments: Array<Pick<Segment, "kind" | "label" | "emoji" | "line" | "mood" | "gesture" | "layout" | "screen"> & { segment: number; acting?: string; trim?: Segment["trim"]; seconds?: number; filmed?: boolean }>;
  estimate?: Estimate;
  sound: { music?: string; volume: number; effects: boolean };
  pendingNotes: number;
  versions: Version[];
  transcript?: string;
  cost?: number;
};
// What filming the latest script costs now, in dollars, for the takes it still needs: takes kept from an earlier cut cost
// nothing. B-roll costs about as much as a take, a picture a few cents, and a line that gets cut off is filmed again,
// longer, so a film can cost a little more.
export type Estimate = { usd: number; seconds: number; segmentsToFilm: number; takesToFilm: number };
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
const LAYOUT_NAMES: Record<Layout, string> = {
  split: "the visual above the presenter",
  full: "the presenter filling the screen",
  overlay: "the presenter filling the screen, with the visual laid over their video",
  green: "the presenter in front of the visual, like a green screen",
  visual: "the visual alone",
};
// Folders in output/ that hold something other than videos.
const NOT_VIDEOS = ["presenters", "personalities", "studio", "brand", "library", "batches"];
// What a screen test says and how, when it isn't told.
const TEST_LINE = "Hey, I'm about to explain your pull request.";
const TEST_DELIVERY = "Friendly and natural, like introducing themselves to their followers.";

// What a video can be made with: the presenters, with the personality each one has, the personalities, the themes, with
// the brand kit's first if there's one, the layouts, the platforms a caption can be written for, and the apps Grok reads
// from. `presenter` is who a new video starts with: the brand kit's, if it has one.
export async function options() {
  const kit = await loadBrand();
  const personalities = await listPersonalities();
  const named = (id: string) => (id.startsWith("@") ? `Like ${id}` : (personalities.find((each) => each.id === id)?.name ?? id));
  const cast = (await listPresenters()).map((each) => ({ id: each.id, name: each.name, personality: personalityOf(each), personalityName: named(personalityOf(each)), voice: each.voice, look: each.look, room: each.room }));
  const builtIn = Object.entries(THEMES).map(([id, { name, summary }]) => ({ id, name, summary }));
  return {
    presenter: kit?.presenter ?? "maya",
    presenters: cast,
    personalities: personalities.map(({ id, name, summary, custom }) => ({ id, name, summary, custom })),
    themes: kit ? [{ id: "brand", name: kit.name || "Your brand", summary: "Your colors and font, from your brand kit." }, ...builtIn] : builtIn,
    layouts: LAYOUTS.map((id) => ({ id, shows: LAYOUT_NAMES[id] })),
    platforms: Object.keys(PLATFORMS),
    takesPerLine: TAKES_PER_LINE,
    apps: (await listSources()).filter((source) => source.enabled).map(({ id, name }) => ({ id, name })),
  };
}

// Every video made so far, newest first, filmed or not, with the video to watch: the current cut, or the latest preview.
export async function list() {
  const folders = existsSync("output") ? await readdir("output", { withFileTypes: true }) : [];
  const found = await Promise.all(
    folders
      .filter((folder) => folder.isDirectory() && !NOT_VIDEOS.includes(folder.name))
      .map(async (folder) => {
        const dir = `output/${folder.name}`;
        if (existsSync(`${dir}/project.json`)) {
          const project: Project = JSON.parse(await readFile(`${dir}/project.json`, "utf8"));
          const shown = project.cut ?? cutsOf(project).findLast((cut) => cut.kind === "preview");
          const { source } = project.draft;
          return [{ project: folder.name, title: project.draft.title || folder.name, about: "pr" in source ? source.pr.url : source.idea, presenter: project.presenter, filmed: Boolean(project.cut), video: shown && resolve(shown.video), duration: tenths(shown?.parts.at(-1)?.end ?? 0), made: (await stat(`${dir}/project.json`)).mtimeMs }];
        }
        if (!existsSync(`${dir}/script.json`) || !existsSync(`${dir}/short.mp4`)) return [];
        // A video made before the app saved projects says less about itself.
        const saved = JSON.parse(await readFile(`${dir}/script.json`, "utf8"));
        return [{ project: folder.name, title: saved.title ?? folder.name, about: saved.about ?? saved.url ?? "", presenter: saved.presenter ?? saved.character ?? "", filmed: true, video: resolve(`${dir}/short.mp4`), duration: tenths(saved.parts?.at(-1)?.end ?? 0), made: (await stat(`${dir}/short.mp4`)).mtimeMs }];
      }),
  );
  return found
    .flat()
    .sort((a, b) => b.made - a.made)
    .map(({ made, ...video }) => ({ ...video, made: new Date(made).toISOString() }));
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
  const kit = await loadBrand();
  const cast = await findPresenter(presenter || kit?.presenter || "maya");
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
  const project = await newProject(kit ? { ...written.draft, theme: "brand" } : written.draft, cast.id);
  project.history.push(...history);
  project.briefed = uploads;
  await saveProject(project);
  return { ...(await videoOf(project)), cost: money(cost) };
}

// Sends Grok a message about the video: answers to its questions, or what to change. The notes that haven't gone to Grok
// yet go with it, each with a picture of its moment, the way the chat sends them, so the message can be empty when there
// are notes. Grok writes the whole script again, changed only as asked, so filming again only films the segments that
// changed. A new `personality` says the same things another way.
export async function revise(name: string, message: string, { personality, onProgress = () => {}, signal }: Steps & { personality?: string } = {}): Promise<Video> {
  const project = await loadProject(name);
  const sending = project.notes.filter((note) => !note.sent);
  if (!message.trim() && !sending.length) throw new Error("Write the answers to Grok's questions or what to change, or add notes first.");
  const style = personality || project.draft.personality;
  const { text, pictures } = sending.length ? await notesMessage(sending, message) : { text: message, pictures: [] };
  // Grok hears what's in the library again whenever it's changed since Grok was last told.
  const uploads = assetsBrief(await listAssets());
  const told = uploads && uploads !== project.briefed ? `${text}\n\n${uploads}` : text;
  let asked: Question[] | undefined;
  const written = await reviseDraft(project.draft, told, style, writeEvents(onProgress, style, (questions) => (asked = questions)), signal, pictures);
  project.draft = written.draft;
  project.briefed = uploads;
  project.history.push({ role: "user", text: message, notes: sending.length ? sending : undefined }, { role: "grok", note: written.note, questions: asked });
  for (const note of sending) note.sent = true;
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

// What changed in the latest script since the current cut, like a new line, another layout, theme, or presenter, or a
// trim, each saying whether filming again films a new take for it, and how many segments need new takes.
export async function changes(name: string, { presenter }: { presenter?: string } = {}) {
  const project = await loadProject(name);
  if (!project.cut) return { project: basename(project.dir), changes: [], segmentsToFilm: 0 };
  const who = presenter || project.presenter;
  const cache = newCache(choicesOf(project));
  const [{ segments: estimates }, listed] = await Promise.all([estimateDraft(project.draft, who, cache, project.dir), takesOf(project.draft, who, cache, project.cut.takes, project.dir)]);
  const each = estimates.map(({ filmed }, index) => ({ filmed, chosen: listed[index]?.chosen }));
  const swapped = who !== project.presenter ? { was: (await findPresenter(project.presenter)).name, is: (await findPresenter(who)).name } : undefined;
  return { project: basename(project.dir), changes: changesSince(project.cut, project.draft, each, swapped), segmentsToFilm: estimates.filter(({ filmed }) => !filmed).length };
}

// Gets what the latest script's segments show, before anything is filmed: screenshots, posts, clips, and pictures, and a
// notice for anything real that couldn't be fetched, which a picture stands in for. Filming uses the same ones. B-roll
// waits for filming, since it costs as much as a take.
export async function visuals(name: string, { onProgress = () => {}, signal }: Steps = {}) {
  const project = await loadProject(name);
  if (!project.draft.segments.length) throw new Error(WAITING);
  const shown: Array<{ segment: number; label: string; file: string; video: boolean; source: string }> = [];
  const notices: string[] = [];
  const events: FilmEvents = {
    media: (index, { file, video, source }) => shown.push({ segment: index + 1, label: project.draft.segments[index].label, file: resolve(file), video, source }),
    notice: (message) => {
      notices.push(message);
      onProgress(message);
    },
  };
  const { cost } = await previewVisuals(project.draft, newCache(project.choices), events, signal, project.dir);
  return { project: basename(project.dir), visuals: shown.sort((a, b) => a.segment - b.segment), notices, cost: money(cost) };
}

// A preview: the presenter's portrait, still, says each line with text to speech, drawn exactly like the real cut, for a
// fraction of a cent, plus a few cents for each picture it draws that an earlier one didn't. It's kept as a version to
// watch, but never becomes the video.
export function preview(name: string, options: Steps & { presenter?: string } = {}): Promise<NewCut> {
  return makeCut(name, true, options);
}

// Films the latest script and cuts it together. Takes of segments that haven't changed since an earlier cut are kept, so
// filming again only pays for what changed. With `maxUsd`, nothing is filmed when the estimate is over it. Takes that
// have started rendering are billed even if the step is stopped, since the API can't cancel a video, so filming again
// picks them up instead of paying for them again.
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

// The hook lab: Grok scores the hook the script has from 1 to 10 for how likely it is to stop someone scrolling, and
// writes four others from different angles, each scored. Use one with line(project, 1, hook).
export async function hooks(name: string) {
  const project = await loadProject(name);
  const hook = project.draft.segments.find((segment) => segment.kind === "hook");
  if (!hook) throw new Error(WAITING);
  const { current, hooks: written, cost } = await hookOptions(project.draft);
  return { project: basename(project.dir), current: { line: hook.line, ...current }, hooks: written, cost: money(cost) };
}

// Writes a script for each source at once, three at a time, without stopping for questions, and previews each one for
// free unless `preview` is false. Each becomes a video like any other, to open, change, and film.
export async function batch(sources: string[], { presenter, personality, preview = true, onProgress = () => {}, signal }: Steps & { presenter?: string; personality?: string; preview?: boolean } = {}) {
  const kit = await loadBrand();
  const cast = await findPresenter(presenter || kit?.presenter || "maya");
  const { batch: started, done } = await startBatch(sources, cast.id, personality || personalityOf(cast), preview, await recentThemes(), () => ({ filming: false }));
  let said = "";
  const report = setInterval(() => {
    const counts = new Map<string, number>();
    for (const item of started.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    const summary = [...counts].map(([status, count]) => `${count} ${status}`).join(", ");
    if (summary !== said) onProgress((said = summary));
  }, 2000);
  try {
    await Promise.race([done, stopped(signal)]);
  } finally {
    clearInterval(report);
  }
  return batchOf(started);
}

// Every batch, newest first.
export async function batches() {
  return (await listBatches()).map(batchOf);
}

// Changes what a segment says, by hand. Grok hears about it with the next message and keeps it.
export function line(name: string, segment: number, text: string): Promise<Video> {
  return edited(name, (project) => (project.draft = setLine(project.draft, indexOf(project, segment), text)));
}

// Changes how a segment is framed, by hand: one of the layouts options() lists.
export function layout(name: string, segment: number, framed: string): Promise<Video> {
  if (!LAYOUTS.includes(framed as Layout)) throw new Error(`Pick a layout: ${LAYOUTS.join(", ")}.`);
  return edited(name, (project) => (project.draft = setLayout(project.draft, indexOf(project, segment), framed as Layout)));
}

// Changes the theme the words are drawn in, by hand. Filming again draws the video again in it without
// filming anything new. "brand" is the brand kit's.
export async function theme(name: string, picked: string): Promise<Video> {
  if (picked === "brand" ? !(await loadBrand()) : !THEME_IDS.includes(picked as (typeof THEME_IDS)[number])) {
    throw new Error(`Pick a theme: ${THEME_IDS.join(", ")}${(await loadBrand()) ? ", or brand" : ""}.`);
  }
  return edited(name, (project) => (project.draft = setTheme(project.draft, picked as ThemeId)));
}

// Moves a beat to another place between the hook and the ending, by hand.
export function move(name: string, segment: number, to: number): Promise<Video> {
  return edited(name, (project) => (project.draft = moveSegmentTo(project.draft, indexOf(project, segment), indexOf(project, to))));
}

// Takes a beat out, or the why of a pull request, by hand. The hook and the ending stay.
export function drop(name: string, segment: number): Promise<Video> {
  return edited(name, (project) => (project.draft = removeSegment(project.draft, indexOf(project, segment))));
}

// Trims a segment's take: `head` and `tail` are how many seconds more to cut from its start and end than the app would,
// up to 3, or less than 0 to keep up to a second more. Nothing is filmed again. An end that isn't given stays as it is.
export function trim(name: string, segment: number, { head, tail }: { head?: number; tail?: number }): Promise<Video> {
  return edited(name, (project) => {
    const index = indexOf(project, segment);
    const trimmed = project.draft.segments[index].trim ?? { head: 0, tail: 0 };
    project.draft = setTrim(project.draft, index, head ?? trimmed.head, tail ?? trimmed.tail);
  });
}

// Shows one of the library's images or videos on a segment, in place of what Grok picked.
export async function useUpload(name: string, segment: number, upload: string): Promise<Video> {
  const asset = await findAsset(upload);
  if (!asset || asset.kind === "audio") throw new Error(`There's no image or video called ${upload} in the library.`);
  return edited(name, (project) => (project.draft = setUpload(project.draft, indexOf(project, segment), asset)));
}

// Changes the music under the video, from the library, or "none", how loud it is, from 0 to 1, and whether there are
// sound effects. It's mixed in after filming, so the next cut costs nothing more for it.
export async function sound(name: string, { music, volume, effects }: { music?: string; volume?: number; effects?: boolean }): Promise<Video> {
  if (music && music !== "none" && (await findAsset(music))?.kind !== "audio") throw new Error(`There's no music called ${music} in the library.`);
  return edited(name, (project) => (project.draft = setSound(project.draft, { music: music === "none" ? "" : music, volume, effects })));
}

// Every take saved for each segment of the latest script, lettered in the order they were filmed, with the one the next
// cut uses, and what retaking the segment would cost.
export async function takes(name: string, { presenter }: { presenter?: string } = {}) {
  const project = await loadProject(name);
  const listed = await takesOf(project.draft, presenter || project.presenter, newCache(choicesOf(project)), project.cut?.takes, project.dir);
  return {
    project: basename(project.dir),
    segments: listed.map(({ files, chosen }, index) => ({
      segment: index + 1,
      label: project.draft.segments[index].label,
      takes: files.map((file, letter) => ({ take: String.fromCharCode(65 + letter), video: resolve(file), chosen: file === chosen })),
      retakeUsd: money(lineSeconds(project.draft.segments[index].line) * TAKES_PER_LINE * TAKE_USD_PER_SECOND),
    })),
  };
}

// Picks one of a segment's takes, by its letter, for the next cut, in place of the one filming kept.
export async function pickTake(name: string, segment: number, take: string, { presenter }: { presenter?: string } = {}) {
  const project = await loadProject(name);
  const index = indexOf(project, segment);
  const who = presenter || project.presenter;
  const cache = newCache(project.choices);
  const { files } = (await takesOf(project.draft, who, cache, project.cut?.takes, project.dir))[index];
  const file = /^[a-z]$/i.test(take) ? files[take.toUpperCase().charCodeAt(0) - 65] : undefined;
  if (!file) throw new Error(files.length ? `Segment ${segment} has takes ${letters(files.length)}.` : `Segment ${segment} has no takes yet. Film it first.`);
  await chooseTake(project.draft, who, cache, index, file, project.dir);
  project.choices = Object.fromEntries(cache.choices);
  await saveProject(project);
  return takes(name, { presenter });
}

// Films more takes of a segment's line with `direction` added, like "more energy" or "slower", and keeps the best new one
// for the next cut. Its other takes stay, to pick from. With `maxUsd`, nothing is filmed when the retake would cost more.
export async function retake(name: string, segment: number, direction: string, { presenter, maxUsd, onProgress = () => {}, signal }: Steps & { presenter?: string; maxUsd?: number } = {}) {
  const project = await loadProject(name);
  const index = indexOf(project, segment);
  const usd = lineSeconds(project.draft.segments[index].line) * TAKES_PER_LINE * TAKE_USD_PER_SECOND;
  if (maxUsd !== undefined && usd > maxUsd) throw new Error(`Retaking segment ${segment} would cost about $${usd.toFixed(2)}, over the cap of $${maxUsd.toFixed(2)}, so nothing was filmed.`);
  const cache = newCache(project.choices);
  const kept = await retakeSegment(project.draft, presenter || project.presenter, cache, index, direction, every(onProgress, "Takes"), signal, project.dir);
  project.choices = Object.fromEntries(cache.choices);
  await saveProject(project);
  return { project: basename(project.dir), segment, video: resolve(kept.file), heard: kept.heard, cost: money(kept.cost) };
}

// Makes an earlier version the video again, with the script it was filmed from. A preview can't be the video.
export async function restore(name: string, version: number): Promise<Video> {
  const project = await loadProject(name);
  await restoreCut(project, versionOf(project, version).id);
  await saveProject(project);
  return videoOf(project);
}

// The frame at `at` seconds as a picture, to post as the video's cover: from the current video, or another version. It's
// halfway through the hook, in its huge letters, unless `at` says otherwise.
export async function cover(name: string, { at, version }: { at?: number; version?: number } = {}) {
  const project = await loadProject(name);
  const cut = version === undefined ? currentOf(project) : versionOf(project, version);
  const hook = cut.parts[0];
  const time = Math.min(Math.max(at ?? (hook ? (hook.start + hook.end) / 2 : 0), 0), Math.max(0, (cut.parts.at(-1)?.end ?? 0) - 0.05));
  const file = `${project.dir}/cover.png`;
  await run("ffmpeg", ["-v", "error", "-y", "-ss", time.toFixed(3), "-i", cut.video, "-frames:v", "1", file]);
  return { project: basename(project.dir), version: numberOf(project, cut), at: tenths(time), cover: resolve(file) };
}

// A note on a version, the latest unless it's another, about what should change `at` seconds in, at a spot on the frame:
// `x` and `y` are shares of its width and height, from the top left. It goes to Grok with the next revise(), with a
// picture of that frame and the spot ringed.
export async function note(name: string, text: string, { at, x = 0.5, y = 0.5, version }: { at?: number; x?: number; y?: number; version?: number }) {
  if (at === undefined) throw new Error("Say when in the video the note is about, in seconds.");
  const project = await loadProject(name);
  const cut = versionOf(project, version);
  const added = await addNote(project, at, x, y, text, { cut });
  await saveProject(project);
  return { project: basename(project.dir), note: noteOf(project, added), pending: project.notes.filter((each) => !each.sent).length };
}

// Every note on the video, with whether it's gone to Grok yet.
export async function notes(name: string) {
  const project = await loadProject(name);
  return { project: basename(project.dir), notes: project.notes.map((each) => noteOf(project, each)) };
}

export async function removeNote(name: string, id: string) {
  const project = await loadProject(name);
  if (!project.notes.some((each) => each.id === id)) throw new Error(`There's no note ${id} on this video.`);
  project.notes = project.notes.filter((each) => each.id !== id);
  await saveProject(project);
  return { project: basename(project.dir), notes: project.notes.map((each) => noteOf(project, each)) };
}

// Grok watches a version, the latest unless it's another, from three frames of every segment, and pins a note on each
// problem a viewer would notice, like a caption over the presenter's mouth. The notes go with the next revise().
export async function review(name: string, { version, signal }: { version?: number; signal?: AbortSignal } = {}) {
  const project = await loadProject(name);
  const cut = versionOf(project, version);
  const { issues, cost } = await reviewCut(cut, signal);
  const added: Note[] = [];
  for (const issue of issues) added.push(await addNote(project, issue.time, issue.x, issue.y, issue.text, { cut, by: "grok" }));
  await saveProject(project);
  return { project: basename(project.dir), version: numberOf(project, cut), notes: added.map((each) => noteOf(project, each)), cost: money(cost) };
}

// The voices a presenter can have.
export function voices() {
  return listVoices();
}

// Says `text` with text to speech, in a voice or a presenter's voice, for a fraction of a cent, like hearing a hook before
// using it. The audio is saved in output/studio/.
export async function speak(text: string, { voice, presenter }: { voice?: string; presenter?: string }) {
  if (!text.trim()) throw new Error("Write something to say.");
  const id = voice || (presenter ? (await findPresenter(presenter)).voice : "");
  if (!id) throw new Error("Pick a voice, or a presenter whose voice to use.");
  await mkdir("output/studio", { recursive: true });
  const file = `output/studio/speech-${Date.now()}.mp3`;
  await writeFile(file, await previewVoice(id, text));
  return { voice: id, audio: resolve(file) };
}

// The library: images, videos, and music to use in any video. Grok is told what's in it, and a segment can show an image
// or video with useUpload(), or a video can play music with sound().
export const library = {
  async list() {
    return (await listAssets()).map(assetOf);
  },
  async add(file: string, name = "") {
    const { size } = await stat(file);
    return assetOf(await addAsset(createReadStream(file), name || basename(file, extname(file)), typeOf(file), size));
  },
  async remove(id: string) {
    if (!(await findAsset(id))) throw new Error(`There's no upload called ${id} in the library.`);
    await removeAsset(id);
    return { removed: id };
  },
};

// The brand kit: a name, up to three colors and a font for the words on screen, a logo in the corner of every frame, an
// end card, and the presenter new videos start with.
export const brand = {
  async show() {
    const kit = await loadBrand();
    return { brand: kit ? brandOf(kit) : null, fonts: FONTS.map(({ id, name, feel }) => ({ id, name, feel })), looks: Object.entries(THEMES).map(([id, { name }]) => ({ id, name })) };
  },
  // Changes what's given and keeps the rest. A brand kit needs at least one color.
  async set(changes: Partial<Omit<Brand, "endCard" | "logo">> & { endCard?: Partial<Brand["endCard"]> }) {
    const kit = await loadBrand();
    const endCard = { on: kit?.endCard.on ?? true, line: kit?.endCard.line ?? "", ...given(changes.endCard ?? {}) };
    return brandOf(await saveBrand({ ...kit, ...given(changes), endCard }));
  },
  async logo(file: string) {
    return brandOf(await saveLogo(await readFile(file), typeOf(file)));
  },
  async removeLogo() {
    const kit = await removeLogo();
    return kit ? brandOf(kit) : null;
  },
  // Reads a brand off a website: its name, colors, font, look, a call to action with its X account, and its logo, saved
  // in output/studio/ to look at. With `save`, they become the brand kit, keeping whether there's an end card.
  async fromWebsite(url: string, { save = false, signal }: { save?: boolean; signal?: AbortSignal } = {}) {
    const { logo, note: read, cost, line: call, ...suggested } = await brandFromWebsite(url, signal);
    const file = logo ? `output/studio/logo-${randomUUID().slice(0, 8)}.png` : undefined;
    if (file && logo) {
      await mkdir("output/studio", { recursive: true });
      await writeFile(file, logo);
    }
    if (save) {
      await brand.set({ name: suggested.name, colors: suggested.colors, font: suggested.font, look: suggested.look as Brand["look"], glow: suggested.glow, endCard: { line: call } });
      if (logo) await saveLogo(logo, "image/png");
    }
    return { suggested: { ...suggested, endCardLine: call, logo: file && resolve(file) }, note: read, saved: save, cost: money(cost) };
  },
};

// Apps Grok reads from while it researches a video, through their remote MCP servers, like GitHub, Slack, or Notion. Their
// tokens stay in output/apps.json, and are never shown. On a computer other people use too, a token here lends its access
// to everyone who makes a video.
export const apps = {
  async list() {
    return { apps: (await listSources()).map(appOf), presets: PRESETS };
  },
  // Adds an app, or changes the one with the same name. A preset fills in its name, address, and what it has.
  async add({ preset, ...fields }: Partial<Omit<Source, "id">> & { preset?: string }) {
    const from = preset ? PRESETS.find((each) => each.name.toLowerCase() === preset.toLowerCase()) : undefined;
    if (preset && !from) throw new Error(`Pick a preset: ${PRESETS.map((each) => each.name).join(", ")}.`);
    return appOf(await saveSource({ name: from?.name, url: from?.url, about: from?.about, ...given(fields) }));
  },
  async remove(id: string) {
    await appNamed(id);
    await removeSource(id);
    return { removed: id };
  },
  // Turns an app on or off without forgetting it.
  async turn(id: string, enabled: boolean) {
    return appOf(await saveSource({ ...(await appNamed(id)), token: "", enabled }));
  },
  // Checks that Grok can reach an app, with the tools it finds there.
  async test(id: string) {
    return { app: id, tools: await testSource(await appNamed(id)) };
  },
};

// Presenter Studio: make up a presenter, or start from a video of a real person who agreed to it, draw portraits of them,
// film a screen test, and save them for the video app. Portraits and frames have to be ones the studio made.
export const presenter = {
  async invent(idea = "") {
    const { draft: invented, cost } = await inventPresenter(await listVoices(), idea);
    return { ...invented, cost: money(cost) };
  },
  // Reads a video of the person, only with `consent` that it's them or that they agreed to it: who talks then, at `at`
  // seconds, or else who talks the most, four frames of them to draw their portraits from, and a sample of their voice,
  // cloned into a custom voice with `cloneVoice`, which takes an Enterprise plan. The video itself isn't kept.
  async fromVideo(video: string, { consent = false, at, cloneVoice: clone = false, name = "", signal }: { consent?: boolean; at?: number; cloneVoice?: boolean; name?: string; signal?: AbortSignal }) {
    if (!consent) throw new Error("Confirm that this is you, or that you have their permission to use their face and voice.");
    const dir = `output/studio/${randomUUID()}`;
    await mkdir(dir, { recursive: true });
    const read = await readVideo(video, dir, at, signal);
    let voiceError: string | undefined;
    const voice = clone
      ? await cloneVoice(read.sample, name, signal).catch((error: Error) => {
          voiceError = error.message;
          return undefined;
        })
      : undefined;
    return { frames: read.frames.map((frame) => resolve(frame)), sample: resolve(read.sample), speech: tenths(read.speech), look: read.look, room: read.room, voice, voiceError };
  },
  // Draws four portraits to pick from, of someone `look` describes, or of the person in one of fromVideo()'s frames.
  async portraits({ look = "", room = "", likeness, signal }: { look?: string; room?: string; likeness?: string; signal?: AbortSignal }) {
    if ((!look.trim() && !likeness) || !room.trim()) throw new Error("Describe the presenter and where they film.");
    const picture = likeness ? new Blob([await readFile(studioFile(likeness))], { type: "image/jpeg" }) : undefined;
    const { images, cost } = await drawPortraits(look, room, 4, signal, picture);
    const dir = `output/studio/${randomUUID()}`;
    await mkdir(dir, { recursive: true });
    const portraits = await Promise.all(
      images.map(async (image, index) => {
        await writeFile(`${dir}/portrait-${index + 1}.jpg`, image);
        return resolve(`${dir}/portrait-${index + 1}.jpg`);
      }),
    );
    return { portraits, cost: money(cost) };
  },
  // Films a few seconds of one of the portraits saying `line` in `voice`, acted the way `delivery` says, for about 70 cents.
  async screenTest(portrait: string, { voice = "", room = "the same place", delivery = TEST_DELIVERY, line: said = TEST_LINE, onProgress = () => {}, signal }: Steps & { voice?: string; room?: string; delivery?: string; line?: string }) {
    if (!voice) throw new Error("Pick a voice for the screen test.");
    const file = studioFile(portrait);
    const take = await filmLine(said, { portrait: new Blob([await readFile(file)], { type: "image/jpeg" }), voice, room, delivery }, file.replace(/\.jpg$/, `-test-${Date.now()}.mp4`), every(onProgress, "Screen test"), signal);
    return { video: resolve(take.file), cost: money(take.cost) };
  },
  // Saves a presenter from one of the studio's portraits, for every video after. A presenter already saved, or a built-in
  // one, given by `id` with no portrait, can change their name, voice, or personality without new portraits.
  async save({ id, name = "", look = "", room = "", voice = "", portrait, personality = "" }: { id?: string; name?: string; look?: string; room?: string; voice?: string; portrait?: string; personality?: string }) {
    if (id && !portrait) {
      const before = await findPresenter(id);
      await savePresenter({ ...before, name: name.trim() || before.name, voice: voice || before.voice, personality: personality || before.personality });
      return { id: before.id };
    }
    if (!portrait) throw new Error("Pick one of the portraits the studio drew, or give the id of a presenter to change.");
    if (!voice || !look.trim() || !room.trim()) throw new Error("Give the presenter a voice, how they look, and where they film.");
    const image = await readFile(studioFile(portrait));
    const { face } = await findFace(new Blob([image], { type: "image/jpeg" }));
    const saved = id || (await newPresenterId(name));
    await savePresenter({ id: saved, name: name.trim() || saved, voice, look, room, face, personality: personality || undefined }, image);
    return { id: saved, face };
  },
};

// Personalities: how a presenter's lines are written and how they act them out, written from an idea, as a surprise, or
// from an X account's posts, tried out in sample lines and a screen test, and saved for the video app.
export const personality = {
  async write(idea = "") {
    const handle = /^\s*@|(?:x|twitter)\.com\//i.test(idea) ? parseHandle(idea) : undefined;
    if (/^\s*@/.test(idea) && !handle) throw new Error(`"${idea.trim()}" isn't an X handle.`);
    const { persona, cost } = handle ? await personaFromX(handle) : await inventPersonality(idea);
    return { ...persona, cost: money(cost) };
  },
  // A few lines in the personality: the hook, a beat, and the ending of a video about `topic`, or a few kinds of video.
  async lines(persona: Persona, topic = "") {
    if (!persona.style?.trim()) throw new Error("Say how they talk first: the personality's style.");
    const { lines, cost } = await sampleLines(persona, topic);
    return { lines, cost: money(cost) };
  },
  async save({ name = "", summary = "", style = "", delivery = "" }: Partial<Persona>) {
    return { id: await savePersonality({ name, summary, style, delivery }) };
  },
  // Films a presenter saying `line` acted the way `delivery` says, for about 70 cents, before saving the personality.
  async screenTest({ presenter: who = "", line: said = "", delivery = "", onProgress = () => {}, signal }: Steps & { presenter?: string; line?: string; delivery?: string }) {
    if (!said.trim() || !delivery.trim()) throw new Error("Write how they act on camera, and a line to film.");
    const cast = await findPresenter(who);
    const { portrait } = await drawPresenter(cast, signal);
    await mkdir("output/personalities/tests", { recursive: true });
    const take = await filmLine(said, { portrait, voice: cast.voice, room: cast.room, delivery }, `output/personalities/tests/${Date.now()}.mp4`, every(onProgress, "Screen test"), signal);
    return { video: resolve(take.file), cost: money(take.cost) };
  },
};

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
  const kept = await keepCut(project, { id: made, video: short.video, made, parts: short.parts, words: short.words, segments: draft.segments, title: draft.title, theme: draft.theme, sound: draft.sound, cost, takes, ...(preview ? { kind: "preview" as const } : {}) });
  await saveProject(project);
  return { project: basename(project.dir), version: cutsOf(project).length, preview, video: resolve(kept.video), duration: tenths(short.duration), cost: money(cost), transcript: short.transcript };
}

async function edited(name: string, change: (project: Project) => void): Promise<Video> {
  const project = await loadProject(name);
  change(project);
  await saveProject(project);
  return videoOf(project);
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
    segments: draft.segments.map(({ kind, label, emoji, line: said, mood, gesture, layout: framed, screen, acting, trim: trimmed }, index) => ({
      segment: index + 1,
      kind,
      label,
      emoji,
      line: said,
      mood,
      ...(gesture ? { gesture } : {}),
      layout: framed,
      screen,
      ...(acting ? { acting } : {}),
      ...(trimmed ? { trim: trimmed } : {}),
      seconds: estimated?.segments[index].seconds,
      filmed: estimated?.segments[index].filmed,
    })),
    estimate: estimated && draft.segments.length ? totals(estimated.segments, estimated.cost) : undefined,
    sound: { ...DEFAULT_SOUND, ...draft.sound },
    pendingNotes: project.notes.filter((each) => !each.sent).length,
    versions: cutsOf(project).map((cut, index) => ({
      version: index + 1,
      preview: cut.kind === "preview",
      video: resolve(cut.video),
      duration: tenths(cut.parts.at(-1)?.end ?? 0),
      cost: money(cut.cost),
      current: Math.round(cut.made) === current,
    })),
    transcript: draft.segments.length ? transcriptOf(draft) : undefined,
  };
}

function indexOf(project: Project, segment: number): number {
  if (!Number.isInteger(segment) || !project.draft.segments[segment - 1]) throw new Error(`There's no segment ${segment}. The script has ${project.draft.segments.length}.`);
  return segment - 1;
}

// A version by its number, or the latest one, preview or not.
function versionOf(project: Project, version?: number): Cut {
  const cuts = cutsOf(project);
  if (!cuts.length) throw new Error("Preview or film the video first.");
  if (version === undefined) return cuts[cuts.length - 1];
  const cut = cuts[version - 1];
  if (!cut) throw new Error(`There's no version ${version}. The video has ${cuts.length}.`);
  return cut;
}

// The version that's the video now.
function currentOf(project: Project): Cut {
  if (!project.cut) throw new Error("Film the video first, or pick a version.");
  const made = Math.round(project.cut.made);
  return cutsOf(project).find((cut) => Math.round(cut.made) === made) ?? project.cut;
}

function numberOf(project: Project, cut: Cut): number {
  return cutsOf(project).findIndex((each) => each.id === cut.id) + 1;
}

function noteOf(project: Project, { id, time, x, y, text, segment, label, word, spot, picture, sent, cut, by }: Note) {
  const version = cutsOf(project).findIndex((each) => each.id === cut) + 1;
  return { id, time: tenths(time), x, y, text, segment: segment + 1, label, word, spot, picture: resolve(picture), version: version || undefined, by: by ?? "you", sent };
}

function batchOf({ id, made, presenter: who, personality: style, preview: previewed, items }: Batch) {
  return {
    batch: id,
    made: new Date(made).toISOString(),
    presenter: who,
    personality: style,
    preview: previewed,
    videos: items.map(({ source, status, folder, title, theme: picked, preview: kept, error }) => ({
      source,
      status,
      project: folder,
      title,
      theme: picked,
      preview: folder && kept ? resolve(`output/${folder}/cuts/${kept}.mp4`) : undefined,
      error,
    })),
  };
}

function assetOf(asset: Asset) {
  return { ...asset, file: resolve(asset.file) };
}

function brandOf(kit: Brand) {
  return { ...kit, logo: kit.logo && resolve(kit.logo) };
}

function appOf({ token, ...source }: Source) {
  return { ...source, token: token ? "saved" : "" };
}

async function appNamed(id: string): Promise<Source> {
  const found = (await listSources()).find((source) => source.id === id);
  if (!found) throw new Error(`There's no app called ${id}.`);
  return found;
}

// The studio only works from portraits and frames it made itself, in output/studio/, so a real person's likeness only
// ever comes from a video someone confirmed they may use.
function studioFile(file: string): string {
  const path = relative(resolve("."), resolve(file)).split(sep).join("/");
  if (!path.startsWith("output/studio/") || !path.endsWith(".jpg") || !existsSync(path)) throw new Error("Use a portrait or frame the studio made, in output/studio/.");
  return path;
}

function totals(segments: Array<{ seconds: number; filmed: boolean }>, cost: number): Estimate {
  const seconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const segmentsToFilm = segments.filter((segment) => !segment.filmed).length;
  return { usd: money(cost), seconds, segmentsToFilm, takesToFilm: segmentsToFilm * TAKES_PER_LINE };
}

// What was given, without the fields left out, so a change only changes what it names.
function given<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function letters(count: number): string {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index)).join(", ");
}

function stopped(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("Stopped.")), { once: true }));
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

// Progress is said every 10%, so a log doesn't fill up with it.
function every(say: Progress, label: string): (percent: number) => void {
  let said = -1;
  return (percent) => {
    const step = Math.floor(percent / 10) * 10;
    if (step <= said) return;
    said = step;
    say(`${label}: ${step}%`);
  };
}

function filmEvents(say: Progress, preview: boolean, segments: number): FilmEvents {
  const percents = Array<number>(segments).fill(0);
  const [takes, frames] = [every(say, preview ? "Lines" : "Takes"), every(say, "Frames")];
  return {
    stage: (stage, status) => status === "active" && say(preview && stage === "film" ? "Saying each line with text to speech" : STAGES[stage]),
    notice: say,
    take: (index, update) => {
      percents[index] = update.status === "done" ? 100 : update.percent;
      takes(percents.reduce((sum, percent) => sum + percent, 0) / segments);
    },
    progress: (frame, total) => frames((frame / total) * 100),
  };
}

function money(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

function tenths(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
