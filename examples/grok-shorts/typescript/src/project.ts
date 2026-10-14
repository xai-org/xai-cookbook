import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { type Timeline, spotAt } from "./frames.ts";
import { parsePullRequestUrl, readPullRequest } from "./github.ts";
import { findPresenter } from "./presenter.ts";
import { DEFAULT_ON_SCREEN, DEFAULT_SOUND, type Draft, type Layout, type OnScreen, type Question, type Screen, type Segment, type Sound, type Source, segmentsOf, sourceKey } from "./script.ts";
import { dirOf } from "./short.ts";
import { THEMES, THEME_IDS, type ThemeId, freshTheme } from "./themes.ts";

const run = promisify(execFile);

// A note on the latest cut: what should change, `time` seconds in, at a spot on the frame, as a share of its width and
// height. It keeps the segment it's in, the word being said, what's at the spot, and a picture of the frame with the
// spot ringed, which Grok gets with the note. `sent` says Grok has had it.
// `by` is "grok" for a note Grok left reviewing a cut.
export type Note = { id: string; time: number; x: number; y: number; text: string; segment: number; label: string; line: string; word: string; spot: string; picture: string; sent: boolean; cut?: number; by?: string };
// A cut of the video: its file, when each segment and word is in it, the script, title, theme, and sound it was made from,
// and the take each segment used. `id` is when it was made, in milliseconds. A preview was made from the portrait and
// text to speech, without filming, to watch before filming. Cuts made before the title and sound were kept don't have them.
export type Cut = { id: number; video: string; made: number; parts: Timeline["parts"]; words: Timeline["words"]; segments: Segment[]; title?: string; theme: ThemeId; onScreen?: OnScreen; sound?: Sound; cost: number; takes?: string[]; kind?: "preview" };
// The conversation, to show it again: your messages, with the notes sent with them, and Grok's notes and questions.
export type Turn = { role: "user"; text: string; notes?: Note[] } | { role: "grok"; note: string; questions?: Question[] };
// A video to keep working on: the folder it's saved in, who presents it, the conversation with Grok and its latest
// script, the notes on its cuts, the current cut, and every cut made so far, oldest first, each in its own file, and the
// takes picked by hand, by the fingerprint of the line they're of, and the list of uploads Grok was last told about. It's
// saved as project.json in its folder after every change.
export type Project = {
  dir: string;
  presenter: string;
  draft: Draft;
  history: Turn[];
  notes: Note[];
  cut?: Cut;
  cuts?: Cut[];
  choices?: Record<string, string>;
  briefed?: string;
};

// What a segment shows, named for a note about it.
const SHOWN: Record<Screen["kind"], string> = {
  headline: "the hook's words",
  "pull-request": "the pull request card",
  code: "the code",
  picture: "the picture",
  broll: "the B-roll",
  page: "the screenshot",
  post: "the X post",
  clip: "the video clip",
  upload: "your upload",
  stamp: "the stamp at the end",
};

// The project for a new conversation. A video made from the same pull request or idea before is in the same folder, and
// its latest cut stays there until the new script is filmed, so the project starts with it.
export async function newProject(draft: Draft, presenter: string): Promise<Project> {
  const dir = dirOf(draft.source);
  const before = await loadProject(basename(dir)).catch(() => undefined);
  return { dir, presenter, draft, history: [], notes: [], cut: before?.cut };
}

// Opens a video in output/ by its folder's name. A video made before the app saved projects is rebuilt from what it
// saved about itself, without its conversation, so Grok carries on from the script as it is.
export async function loadProject(name: string): Promise<Project> {
  if (!/^[a-z0-9][\w-]*$/i.test(name) || ["presenters", "personalities", "studio", "brand", "library", "batches"].includes(name)) throw new Error("There's no video by that name.");
  const dir = `output/${name}`;
  if (existsSync(`${dir}/project.json`)) {
    const project: Project = JSON.parse(await readFile(`${dir}/project.json`, "utf8"));
    project.draft.segments = project.draft.segments.map(upgrade);
    project.cuts = project.cuts?.map((cut) => ({ ...cut, segments: cut.segments.map(upgrade) }));
    if (project.cut) project.cut = { ...project.cut, segments: project.cut.segments.map(upgrade) };
    return project;
  }
  if (!existsSync(`${dir}/script.json`)) throw new Error("There's no video by that name.");
  const saved = JSON.parse(await readFile(`${dir}/script.json`, "utf8"));
  const about: string = saved.about ?? saved.url ?? "";
  const pr = isPullRequestLink(about) ? await readPullRequest(about) : undefined;
  const source: Source = pr ? { pr } : { idea: about };
  const presenter = await findPresenter(saved.presenter ?? saved.character ?? "").catch(() => undefined);
  const segments: Segment[] = (saved.segments ?? (saved.script ? segmentsOf(source, saved.script) : [])).map(upgrade);
  const theme: ThemeId = saved.theme === "brand" || THEME_IDS.includes(saved.theme) ? saved.theme : freshTheme([], name);
  const draft: Draft = {
    source,
    title: saved.title ?? name,
    personality: saved.personality ?? "hype",
    persona: saved.persona,
    look: presenter?.look ?? "",
    theme,
    segments,
    responseId: "",
    // Grok's searches found the pages, posts, and videos the script shows, so a new conversation can keep showing them.
    sources: segments.flatMap(({ screen }) => ("url" in screen ? [sourceKey(screen.url)] : [])),
    edits: [],
  };
  const video = `${dir}/short.mp4`;
  const made = existsSync(video) ? Math.round((await stat(video)).mtimeMs) : 0;
  const cut = made && saved.parts ? { id: made, video, made, parts: saved.parts, words: saved.words ?? [], segments, theme, cost: 0 } : undefined;
  return { dir, presenter: presenter?.id ?? saved.presenter ?? "", draft, history: [], notes: [], cut, cuts: cut ? [cut] : [] };
}

// Every cut of a project, oldest first. A project saved before versions were kept has only its latest.
export function cutsOf(project: Project): Cut[] {
  const cuts = project.cuts?.length ? project.cuts : project.cut ? [project.cut] : [];
  return cuts.map((cut) => ({ ...cut, id: cut.id ?? Math.round(cut.made) }));
}

// A video made before versions were kept has its only cut at `short.mp4`, which filming writes over, so it's copied into
// cuts/ first.
export async function archiveCurrent(project: Project): Promise<void> {
  const { cut } = project;
  if (!cut || cut.video !== `${project.dir}/short.mp4` || !existsSync(cut.video)) return;
  const id = cut.id ?? Math.round(cut.made);
  await mkdir(`${project.dir}/cuts`, { recursive: true });
  const archived = { ...cut, id, video: `${project.dir}/cuts/${id}.mp4` };
  await copyFile(cut.video, archived.video);
  project.cuts = cutsOf(project).map((each) => (each.id === id ? archived : each));
  project.cut = archived;
}

// Keeps a new cut, copied into cuts/ so filming again doesn't write over it, as the project's current one, unless it's a
// preview. The current cut stays at `short.mp4` too, where Your Videos finds it.
export async function keepCut(project: Project, cut: Cut): Promise<Cut> {
  await mkdir(`${project.dir}/cuts`, { recursive: true });
  const kept = { ...cut, video: `${project.dir}/cuts/${cut.id}.mp4` };
  await copyFile(cut.video, kept.video);
  project.cuts = [...cutsOf(project), kept];
  if (cut.kind !== "preview") project.cut = kept;
  return kept;
}

// Makes an earlier cut the current one again: its video goes back to `short.mp4`, and the script goes back to what it
// was filmed from, which Grok hears about with the next message.
export async function restoreCut(project: Project, id: number): Promise<Cut> {
  const cuts = cutsOf(project);
  const index = cuts.findIndex((cut) => cut.id === id);
  if (index < 0) throw new Error("There's no such version.");
  const cut = cuts[index];
  if (cut.kind === "preview") throw new Error("A preview can't be the video. Film it to make it one.");
  if (cut.video !== `${project.dir}/short.mp4`) await copyFile(cut.video, `${project.dir}/short.mp4`);
  project.cut = cut;
  project.draft = { ...project.draft, segments: cut.segments, theme: cut.theme, edits: [...project.draft.edits, `I went back to version ${index + 1}, so the script is as it was when that version was filmed.`] };
  return cut;
}

// A change to the latest script since a cut, said the way the page says it, and whether filming again films a new take
// for it, or only cuts the video again.
export type Change = { text: string; film: boolean };

const LAYOUT_NAMES: Record<Layout, string> = { overlay: "Overlay", split: "Split", full: "Full screen", green: "Green screen", bubble: "Bubble", visual: "Visual only" };

// What changed in the latest script since `cut` was made: who presents it, which segments were added, taken out,
// renamed, or moved, what each one says, how it's acted, framed, shown, and trimmed, and which take it uses, and the
// video's title, theme, words on screen, and sound. `takes` says, for each segment of the draft, whether its take is
// filmed already and which take the next cut uses, and `presenter` names who presented the cut and who'd film it now,
// when they're different. A segment is the same one in both when it has the same label, or it's renamed when the
// segment of the same kind in its place has a label that's gone.
export function changesSince(cut: Cut, draft: Draft, takes: Array<{ filmed: boolean; chosen?: string }>, presenter?: { was: string; is: string }): Change[] {
  const changes: Change[] = [];
  if (presenter) changes.push({ text: `${presenter.is} presents it instead of ${presenter.was}`, film: true });
  const labels = new Set(draft.segments.map((segment) => segment.label));
  const quoted = (label: string) => `“${label.charAt(0).toUpperCase()}${label.slice(1)}”`;
  const matched: number[] = [];
  draft.segments.forEach((segment, index) => {
    const name = quoted(segment.label);
    const film = !takes[index]?.filmed;
    let before = cut.segments.findIndex((old) => old.label === segment.label);
    const inPlace = cut.segments[index];
    if (before < 0 && inPlace?.kind === segment.kind && !labels.has(inPlace.label)) {
      before = index;
      changes.push({ text: `Renamed ${quoted(inPlace.label)} to ${name}`, film: false });
    }
    if (before < 0) return changes.push({ text: `Added ${name}`, film });
    matched.push(before);
    const old = cut.segments[before];
    const acted = old.line !== segment.line || old.mood !== segment.mood || old.acting !== segment.acting || old.layout !== segment.layout;
    if (old.line !== segment.line) changes.push({ text: `New line for ${name}`, film });
    if (old.mood !== segment.mood || old.acting !== segment.acting) changes.push({ text: `${name} is acted differently`, film });
    if (old.layout !== segment.layout) changes.push({ text: `${name}: ${LAYOUT_NAMES[old.layout]} → ${LAYOUT_NAMES[segment.layout]}`, film });
    if (film && !acted && !presenter) changes.push({ text: `New take of ${name}`, film });
    if (JSON.stringify(old.screen) !== JSON.stringify(segment.screen)) changes.push({ text: `${name} shows something else`, film: false });
    if (JSON.stringify(old.trim ?? null) !== JSON.stringify(segment.trim ?? null)) changes.push({ text: `Trimmed ${name}`, film: false });
    const chosen = takes[index]?.chosen;
    if (!film && chosen && cut.takes?.[before] && chosen !== cut.takes[before]) changes.push({ text: `Another take of ${name}`, film: false });
  });
  for (const [index, old] of cut.segments.entries()) if (!matched.includes(index)) changes.push({ text: `Took out ${quoted(old.label)}`, film: false });
  if (matched.some((before, at) => at > 0 && before < matched[at - 1])) changes.push({ text: "The segments are in a new order", film: false });

  const shown = { ...DEFAULT_ON_SCREEN, ...draft.onScreen };
  const wasShown = { ...DEFAULT_ON_SCREEN, ...cut.onScreen };
  if (cut.title !== undefined && cut.title !== draft.title && shown.title) changes.push({ text: `Renamed the video to “${draft.title}”`, film: false });
  const themeName = (theme: ThemeId) => (theme === "brand" ? "Your brand" : (THEMES[theme]?.name ?? theme));
  if (cut.theme !== draft.theme) changes.push({ text: `Theme: ${themeName(cut.theme)} → ${themeName(draft.theme)}`, film: false });
  if (wasShown.title !== shown.title) changes.push({ text: shown.title ? "The title shows on screen" : "The title is off the screen", film: false });
  if (wasShown.labels !== shown.labels) changes.push({ text: shown.labels ? "The labels show on their stickers" : "The labels are off the stickers", film: false });
  if (cut.sound) {
    const sound = { ...DEFAULT_SOUND, ...draft.sound };
    const was = { ...DEFAULT_SOUND, ...cut.sound };
    if (was.music !== sound.music) changes.push({ text: !was.music ? "Music under the video" : !sound.music ? "No music" : "Other music", film: false });
    else if (sound.music && was.volume !== sound.volume) changes.push({ text: sound.volume > was.volume ? "The music is louder" : "The music is quieter", film: false });
    if (was.effects !== sound.effects) changes.push({ text: sound.effects ? "Sound effects on" : "Sound effects off", film: false });
  }
  return changes;
}

export async function saveProject(project: Project): Promise<void> {
  await mkdir(project.dir, { recursive: true });
  await writeFile(`${project.dir}/project.json`, JSON.stringify(project, null, 2));
}

// A new note on a cut, the current one unless it's another, with the segment it's in, the word being said, what's at the
// spot, and a picture of the frame with the spot ringed, saved in the video's notes/ folder. `by` is "grok" for a note
// Grok left reviewing the cut.
export async function addNote(project: Project, at: number, atX: number, atY: number, text: string, { cut = project.cut, by }: { cut?: Cut; by?: string } = {}): Promise<Note> {
  if (!cut) throw new Error("Film the video first, then add notes on it.");
  if (!text.trim()) throw new Error("Write what should change.");
  const time = clamp(at, 0, cut.parts.at(-1)?.end ?? 0);
  const [x, y] = [clamp(atX, 0, 1), clamp(atY, 0, 1)];
  const index = Math.max(0, cut.parts.findLastIndex((part) => part.start <= time));
  const [part, segment] = [cut.parts[index], cut.segments[index]];
  const word = cut.words.findLast((each) => each.part === index && each.start <= time)?.text.replace(/[.,;:!?"]+$/, "") ?? "";
  const id = randomUUID().slice(0, 8);
  await mkdir(`${project.dir}/notes`, { recursive: true });
  const picture = `${project.dir}/notes/${id}.jpg`;
  await writeFile(picture, await ringedFrame(cut.video, time, x, y));
  const shows = segment ? SHOWN[segment.screen.kind] : "the video";
  const note: Note = { id, time, x, y, text: text.trim(), segment: index, label: segment?.label ?? part.kind, line: segment?.line ?? "", word, spot: spotAt(part.kind, part.layout, shows, x, y, { ...DEFAULT_ON_SCREEN, ...cut.onScreen }), picture, sent: false, cut: cut.id, ...(by ? { by } : {}) };
  project.notes.push(note);
  return note;
}

// The notes, as a message to Grok with a picture of each one's moment, after anything else you wrote.
export async function notesMessage(notes: Note[], message: string): Promise<{ text: string; pictures: Blob[] }> {
  const lines = notes.map((note, index) => {
    const where = [`at ${clock(note.time)}`, `in segment ${note.segment + 1}, "${note.label}"`, note.word && `as the presenter says "${note.word}"`, `about ${note.spot}`].filter(Boolean).join(", ");
    return `${index + 1}. ${where}: ${note.text}\n   That segment's line is "${note.line}"`;
  });
  const asked = message.trim() ? `${message.trim()}\n\n` : "";
  const text = `${asked}My notes on the latest cut. There's a picture of each one's moment in the video, in the same order, with a ring around the spot it's about.\n${lines.join("\n")}\n\nChange the script to take care of them. If a note asks for something the script can't change, like how the captions look, say so in your note.`;
  const pictures = await Promise.all(notes.map(async (note) => new Blob([await readFile(note.picture)], { type: "image/jpeg" })));
  return { text, pictures };
}

// The video's frames, one a second, side by side and 120 pixels tall, for the timeline under the phone, saved next to
// it. It's made again whenever the video is newer than it.
export async function filmstrip(video: string, duration: number): Promise<{ file: string; frames: number }> {
  const file = video.replace(/\.mp4$/, "-filmstrip.jpg");
  const frames = Math.max(1, Math.min(240, Math.ceil(duration)));
  if (!existsSync(file) || (await stat(file)).mtimeMs < (await stat(video)).mtimeMs) {
    await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1,scale=-2:120,tile=${frames}x1`, "-frames:v", "1", "-q:v", "5", file]);
  }
  return { file, frames };
}

// The frame of the video at `time`, half size, with a ring around the spot.
async function ringedFrame(video: string, time: number, x: number, y: number): Promise<Buffer> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", time.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=540:960", "-f", "image2pipe", "-c:v", "png", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 26 });
  const frame = await loadImage(stdout);
  const canvas = createCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(frame, 0, 0);
  for (const [width, color] of [[9, "#fff"], [4, "#ff2d55"]] as const) {
    ctx.beginPath();
    ctx.arc(x * frame.width, y * frame.height, 36, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  return canvas.toBuffer("image/jpeg", 88);
}

// A segment saved by an earlier version of the app, before segments had layouts and acting. Every segment was filmed in
// a split then.
function upgrade(segment: Segment): Segment {
  return { ...segment, layout: segment.layout ?? "split", acting: segment.acting ?? "" };
}

function isPullRequestLink(text: string): boolean {
  try {
    parsePullRequestUrl(text);
    return true;
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
