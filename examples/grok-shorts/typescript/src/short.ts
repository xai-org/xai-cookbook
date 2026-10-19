import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { type Canvas, ImageData, createCanvas, loadImage } from "@napi-rs/canvas";
import { END_CARD_SECONDS, loadBrand, themeFor } from "./brand.ts";
import { type Card, FPS, HEIGHT, type Marks, TAKE_HEIGHT, TAKE_WIDTH, type Timeline, WIDTH, frameDrawer } from "./frames.ts";
import { type PullRequest, parsePullRequestUrl, readPullRequest } from "./github.ts";
import { findAsset } from "./library.ts";
import { downloadClip, drawPicture, filmBroll, screenshotPage, screenshotPost, sourceLabel, videoSize } from "./media.ts";
import { type Persona, findPersonality, listPersonalities, parseHandle, personaFromX } from "./persona.ts";
import { type Presenter, drawGreenPortrait, drawPresenter, findPresenter } from "./presenter.ts";
import { DEFAULT_ON_SCREEN, DEFAULT_SOUND, type Draft, type OnScreen, type ScriptEvents, type Screen, type Segment, type Source, type Trim, reviseScript, writeScript } from "./script.ts";
import { type Part, TAKES_PER_LINE, TAKE_USD_PER_SECOND, type Take, lineSeconds, recordTake, savedTakes, speakTake } from "./takes.ts";
import type { Theme } from "./themes.ts";

const run = promisify(execFile);

export const DEFAULT_PULL_REQUEST = "https://github.com/sindresorhus/ky/pull/867";

export type Stage = "read" | "persona" | "write" | "draw" | "visuals" | "film" | "edit";
export type TakeUpdate = { status: "filming"; percent: number } | { status: "done"; take: Take; reused: boolean };
// What a segment shows, once it's fetched or made: a picture, a screenshot, or a video, how it fits on screen, and where
// it came from.
export type Media = { file: string; video: boolean; fit: "cover" | "contain" | "scroll"; source: string };
// The takes and media made so far in a conversation, by what they were made from, so a segment that didn't change isn't
// filmed or fetched again when the video is made again. Media are kept from the moment they're asked for, so a preview
// and a cut that want the same one while it's being fetched share it.
// `choices` has the take someone picked for a line, by the fingerprint of what it's filmed from, which filming keeps
// instead of picking one itself.
export type Cache = { takes: Map<string, Take>; media: Map<string, Promise<Media | undefined>>; choices: Map<string, string> };
export type Short = {
  dir: string;
  video: string;
  transcript: string;
  takes: Take[];
  duration: number;
  // When each segment starts and ends in the video, in seconds, and how it's framed, and when each word is said.
  parts: Timeline["parts"];
  words: Timeline["words"];
  // What this cut cost. Takes and media kept from an earlier cut cost nothing.
  cost: { presenter: number; media: number; takes: number };
};
export type WriteEvents = ScriptEvents & {
  stage?: (stage: Stage, status: "active" | "done") => void;
  pullRequest?: (pr: PullRequest) => void;
  persona?: (persona: Persona) => void;
};
export type FilmEvents = {
  stage?: (stage: Stage, status: "active" | "done") => void;
  portrait?: (file: string) => void;
  media?: (index: number, media: Media) => void;
  notice?: (message: string) => void;
  take?: (index: number, update: TakeUpdate) => void;
  progress?: (frame: number, frames: number) => void;
};

// What the presenter points at while saying a segment's line.
const POINT_AT: Partial<Record<Screen["kind"], string>> = {
  "pull-request": "the pull request",
  code: "the code",
  picture: "the picture",
  upload: "the picture",
  broll: "the clip",
  page: "the screenshot",
  post: "the post",
  clip: "the clip",
};
const GREEN_ROOM = "a studio, in front of a flat, evenly lit green screen that fills the whole background";
// How close to the green screen's color a pixel has to be to be keyed out, and how far past that the edges fade. Gray,
// black, and white are about 0.2 from a chroma key green, so the fade ends before them, or dark clothes come out
// see-through.
const KEY = { similarity: 0.1, blend: 0.05 };

// Starts a conversation about a video. If the message has a link to a pull request, the video explains it, and the rest
// of the message says what to make of it. A pull request read some other way, like with an agent's own access to a
// private repository, can come as `pr` instead, and then the whole message says what to make of it. Otherwise the
// message is the idea for the video. `personality` is the id of a personality, built in or made in Personality Studio,
// or an X handle with its @ to copy the style of. `uploads` lists the creator's own uploads, for Grok to show where they
// fit, and `avoid` has the themes of their last few videos, so this one looks different.
export async function startDraft(
  message: string,
  presenterId: string,
  personality: string,
  on: WriteEvents = {},
  signal?: AbortSignal,
  uploads = "",
  avoid: string[] = [],
  pr?: PullRequest,
): Promise<{ draft: Draft; note: string; cost: number }> {
  const presenter = await findPresenter(presenterId);
  const words = message.trim().split(/\s+/);
  const link = pr ? undefined : words.find(isPullRequestLink);
  if (link) on.stage?.("read", "active");
  if (pr) on.pullRequest?.(pr);
  on.stage?.("persona", "active");
  // Grok reads the account's posts for an X handle, at the same time as the app reads the pull request.
  const [source, styled] = await Promise.all([
    link
      ? readPullRequest(link, signal).then((read): Source => {
          on.pullRequest?.(read);
          on.stage?.("read", "done");
          return { pr: read, ask: words.filter((word) => word !== link).join(" ") };
        })
      : ((pr ? { pr, ask: message.trim() } : { idea: message.trim() }) as Source),
    findPersona(personality, signal).then((found) => {
      on.persona?.(found.persona);
      on.stage?.("persona", "done");
      return found;
    }),
  ]);
  on.stage?.("write", "active");
  const written = await writeScript(source, presenter.look, personality, styled.persona, on, signal, uploads, avoid);
  on.stage?.("write", "done");
  return { ...written, cost: written.cost + styled.cost };
}

// Has Grok change the script the way the message asks, with `pictures` it's about, like frames of the video. A new
// personality is worked out first and goes along with it.
export async function reviseDraft(
  draft: Draft,
  message: string,
  personality: string,
  on: WriteEvents = {},
  signal?: AbortSignal,
  pictures: Blob[] = [],
): Promise<{ draft: Draft; note: string; cost: number }> {
  let { persona } = draft;
  let cost = 0;
  if (personality !== draft.personality) {
    on.stage?.("persona", "active");
    ({ persona, cost } = await findPersona(personality, signal));
    on.persona?.(persona);
    on.stage?.("persona", "done");
  }
  on.stage?.("write", "active");
  const written = await reviseScript(draft, message, personality, persona, on, signal, pictures);
  on.stage?.("write", "done");
  return { ...written, cost: written.cost + cost };
}

// Films each segment of the draft that wasn't filmed before, gets what each one shows, and cuts the video together,
// saving everything to `dir`, the video's folder in output/. `presenterId` is a built-in presenter or one saved from
// Presenter Studio. A `preview` films nothing: each take is the portrait, still, saying its line with text to speech,
// and the video is saved as preview.mp4, so the whole thing can be watched for a fraction of a cent before filming it.
export async function filmDraft(
  draft: Draft,
  presenterId: string,
  cache: Cache,
  on: FilmEvents = {},
  signal?: AbortSignal,
  dir = dirOf(draft.source),
  { preview = false }: { preview?: boolean } = {},
): Promise<Short> {
  await run("ffmpeg", ["-version"]).catch(() => {
    throw new Error("This app needs ffmpeg to make the video. Install it from https://ffmpeg.org and try again.");
  });
  const presenter = await findPresenter(presenterId);
  const brand = await loadBrand();
  await mkdir(dir, { recursive: true });

  // Grok Imagine draws the presenter, unless an earlier video did, and every take starts from that portrait. A segment in
  // front of a green screen is filmed from a portrait of them in front of one, drawn from the first.
  on.stage?.("draw", "active");
  const drawing = drawPresenter(presenter, signal).then((drawn) => {
    on.portrait?.(drawn.file);
    on.stage?.("draw", "done");
    return drawn;
  });
  const greened = draft.segments.some((segment) => segment.layout === "green");
  const greening = greened ? drawing.then((drawn) => drawGreenPortrait({ ...presenter, face: drawn.face }, drawn.portrait, signal)) : undefined;
  // They're awaited below, so a failure before then isn't an unhandled rejection.
  drawing.catch(() => {});
  greening?.catch(() => {});

  const media = getVisuals(draft, cache, dir, true, on, signal);
  media.catch(() => {});

  // A take is kept for as long as the presenter, how they act, and what they say and do stay the same.
  on.stage?.("film", "active");
  const { delivery } = draft.persona;
  const filming = new Map<string, Promise<Take>>();
  if (preview) await mkdir(`${dir}/preview`, { recursive: true });
  const takes = draft.segments.map(async (segment, index) => {
    const { part, green, room, key } = takeOf(segment, presenter, delivery);
    if (preview) {
      const picture = green ? await greening!.then((drawn) => ({ portrait: drawn.portrait, green: drawn.green })) : await drawing.then((drawn) => ({ portrait: drawn.portrait }));
      const take = await speakTake(part, { ...picture, voice: presenter.voice, room, delivery }, `${dir}/preview/${fingerprint(key)}`, signal);
      on.take?.(index, { status: "done", take, reused: !take.cost });
      return { take, reused: !take.cost };
    }
    const kept = cache.takes.get(key);
    if (kept) {
      on.take?.(index, { status: "done", take: kept, reused: true });
      return { take: kept, reused: true };
    }
    if (!filming.has(key)) {
      // A take in front of the green screen is judged by how cleanly its green keys out.
      const pictured = green ? greening!.then((drawn) => ({ portrait: drawn.portrait, green: drawn.green })) : drawing.then((drawn) => ({ portrait: drawn.portrait }));
      const cast = pictured.then((picture) => ({ ...picture, voice: presenter.voice, room, delivery }));
      const pick = cache.choices.get(fingerprint(key));
      const options = pick && existsSync(pick) ? { pick } : {};
      filming.set(key, cast.then((ready) => recordTake(part, ready, `${dir}/take-${fingerprint(key)}`, (percent) => on.take?.(index, { status: "filming", percent }), signal, options)));
    }
    const take = await filming.get(key)!;
    cache.takes.set(key, take);
    on.take?.(index, { status: "done", take, reused: false });
    return { take, reused: false };
  });
  const [drawn, recorded, { media: shownMedia, cost: mediaCost }, greenScreen] = await Promise.all([drawing, Promise.all(takes), media, greening]);
  on.stage?.("film", "done");

  on.stage?.("edit", "active");
  // A segment trimmed on the timeline uses less of its take, or more.
  const kept = recorded.map(({ take }, index) => trimmed(take, draft.segments[index].trim));
  const timeline = toTimeline(draft.segments, kept);
  const cut = `${dir}/${preview ? "preview-cut" : "cut"}.mp4`;
  // The brand kit's end card plays after the last line, for a few seconds more.
  const tail = brand?.endCard.on ? END_CARD_SECONDS : 0;
  await cutTakes(kept, cut, signal, tail);
  timeline.duration += tail;
  const video = `${dir}/${preview ? "preview" : "short"}.mp4`;
  const clips = await Promise.all(shownMedia.map(async (got) => (got?.video ? { file: got.file, size: fitWithin(await videoSize(got.file), 1080) } : undefined)));
  const marks = brand && { logo: brand.logo ? await loadImage(brand.logo) : undefined, watermark: brand.watermark, endCard: brand.endCard.on ? { name: brand.name, line: brand.endCard.line } : undefined };
  const sound = { ...DEFAULT_SOUND, ...draft.sound };
  const song = sound.music ? await findAsset(sound.music) : undefined;
  const music = song?.kind === "audio" ? { file: song.file, volume: sound.volume } : undefined;
  const onScreen = { ...DEFAULT_ON_SCREEN, ...draft.onScreen };
  await compose(tagOf(draft), await toCards(draft, shownMedia), timeline, drawn.face, themeFor(draft.theme, brand), onScreen, greenScreen?.green, clips, cut, video, on.progress, signal, marks, { effects: sound.effects, music });
  const text = transcriptOf(draft);
  if (!preview) {
    const takeInfo = kept.map(({ file, prompt, seconds, filmed, heard, cost }) => ({ kept: file, prompt, seconds, filmed, heard, cost }));
    const about = "pr" in draft.source ? draft.source.pr.url : draft.source.idea;
    const saved = { about, title: draft.title, presenter: presenter.id, personality: draft.personality, persona: draft.persona, theme: draft.theme, segments: draft.segments, parts: timeline.parts, takes: takeInfo };
    await writeFile(`${dir}/script.json`, JSON.stringify(saved, null, 2));
    await writeFile(`${dir}/transcript.md`, text);
  }
  on.stage?.("edit", "done");

  const takeCost = recorded.reduce((sum, { take, reused }) => sum + (reused ? 0 : take.cost), 0);
  const cost = { presenter: drawn.cost + (greenScreen?.cost ?? 0), media: mediaCost, takes: takeCost };
  return { dir, video, transcript: text, takes: kept, duration: timeline.duration, parts: timeline.parts, words: timeline.words, cost };
}

// Gets what the script's segments show before anything is filmed, so they can be looked at in the chat and changed. B-roll
// waits for filming, since it costs as much as a take.
export async function previewVisuals(draft: Draft, cache: Cache, on: FilmEvents = {}, signal?: AbortSignal, dir = dirOf(draft.source)): Promise<{ cost: number }> {
  await mkdir(dir, { recursive: true });
  return { cost: (await getVisuals(draft, cache, dir, false, on, signal)).cost };
}

export function newCache(choices: Record<string, string> = {}): Cache {
  return { takes: new Map(), media: new Map(), choices: new Map(Object.entries(choices)) };
}

// Gets what each segment shows, from the cache or by fetching it, and reports each one as it's ready. B-roll is filmed
// only when `broll` is set. What a fetch costs is counted by whoever started it.
async function getVisuals(draft: Draft, cache: Cache, dir: string, broll: boolean, on: FilmEvents, signal?: AbortSignal): Promise<{ media: Array<Media | undefined>; cost: number }> {
  let cost = 0;
  const wanted = draft.segments.some((segment) => isMedia(segment.screen) && (broll || segment.screen.kind !== "broll"));
  if (wanted) on.stage?.("visuals", "active");
  const media = await Promise.all(
    draft.segments.map(async (segment, index) => {
      if (!isMedia(segment.screen) || (!broll && segment.screen.kind === "broll")) return undefined;
      // Pictures and clips that Grok Imagine makes are made in the shape of the space they fill. A page, post, or clip is the
      // same whichever beat shows it, so it's fetched once.
      const { screen } = segment;
      const aspect = segment.layout === "split" || segment.layout === "overlay" ? "4:3" : "9:16";
      const key = JSON.stringify(
        screen.kind === "picture" || screen.kind === "broll" ? [screen, aspect] : screen.kind === "upload" ? [screen.kind, screen.asset] : [screen.kind, screen.url, screen.kind === "clip" ? screen.start : 0],
      );
      let fetching = cache.media.get(key);
      if (!fetching) {
        fetching = fetchMedia(segment, aspect, `${dir}/${screen.kind}-${fingerprint(key)}`, on, signal).then((fetched) => {
          cost += fetched.cost;
          return fetched.media;
        });
        cache.media.set(key, fetching);
        // A fetch that stopped, because the page that asked for it closed, is tried again next time.
        fetching.catch(() => cache.media.delete(key));
      }
      const got = await fetching;
      if (got) on.media?.(index, got);
      return got;
    }),
  );
  if (wanted) on.stage?.("visuals", "done");
  return { media, cost };
}

function isMedia(screen: Screen): screen is Extract<Screen, { kind: "picture" | "broll" | "page" | "post" | "clip" | "upload" }> {
  return ["picture", "broll", "page", "post", "clip", "upload"].includes(screen.kind);
}

// Gets what a segment shows: a picture or a clip that Grok Imagine makes, a screenshot of a page or an X post, or a few
// seconds of a video, sized for about as long as the line takes to say. Anything real that can't be fetched, like a page
// behind a login, becomes the picture Grok described in its place, and a picture that can't be drawn, like one that
// doesn't pass moderation, leaves the beat's emoji.
async function fetchMedia(segment: Segment, aspect: "4:3" | "9:16", name: string, on: FilmEvents, signal?: AbortSignal): Promise<{ media?: Media; cost: number }> {
  const screen = segment.screen as Extract<Screen, { prompt: string }>;
  // The creator's own upload is shown as it is, whole if it's an image. One that's gone from the library becomes a
  // picture of what it was called.
  if (screen.kind === "upload") {
    const asset = await findAsset(screen.asset);
    if (asset && asset.kind !== "audio") return { media: { file: asset.file, video: asset.kind === "video", fit: asset.kind === "video" ? "cover" : "contain", source: "" }, cost: 0 };
    on.notice?.(`${segment.label}: the upload "${screen.prompt}" isn't in your library anymore. It shows a picture instead.`);
  }
  // What an earlier fetch saved, like one from before the server restarted, is used again: a picture or a clip that Grok
  // Imagine makes would come out different, and cost as much again.
  const saved = savedMedia(screen, name);
  if (saved) return { media: saved, cost: 0 };
  const seconds = lineSeconds(segment.line);
  const picture = async () => {
    const drawn = await drawPicture(screen.prompt, aspect, `${name}.jpg`, signal).catch(() => undefined);
    return { media: drawn && { file: drawn.file, video: false, fit: "cover" as const, source: "" }, cost: drawn?.cost ?? 0 };
  };
  try {
    if (screen.kind === "page") return { media: { file: await screenshotPage(screen.url, `${name}.png`, signal), video: false, fit: "scroll", source: sourceLabel(screen.url) }, cost: 0 };
    if (screen.kind === "post") return { media: { file: await screenshotPost(screen.url, `${name}.png`, signal), video: false, fit: "contain", source: sourceLabel(screen.url) }, cost: 0 };
    if (screen.kind === "clip") return { media: { file: await downloadClip(screen.url, screen.start, seconds + 1, name, signal), video: true, fit: "cover", source: sourceLabel(screen.url) }, cost: 0 };
    if (screen.kind === "broll") {
      const filmed = await filmBroll(screen.prompt, seconds, aspect, `${name}.mp4`, signal);
      return { media: { file: filmed.file, video: true, fit: "cover", source: "" }, cost: filmed.cost };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // A screenshot that failed, like a blank one, mustn't be taken for a good one the next time.
    await rm(`${name}.png`, { force: true });
    on.notice?.(`${segment.label}: ${error instanceof Error ? error.message : String(error)} It shows a picture instead.`);
  }
  return picture();
}

// What an earlier fetch saved as `name`: the screenshot, clip, or B-roll it got, or for a page, post, or clip it couldn't
// get, the picture drawn in its place.
function savedMedia(screen: Extract<Screen, { prompt: string }>, name: string): Media | undefined {
  if (existsSync(`${name}.jpg`)) return { file: `${name}.jpg`, video: false, fit: "cover", source: "" };
  if ((screen.kind === "page" || screen.kind === "post") && existsSync(`${name}.png`)) return { file: `${name}.png`, video: false, fit: screen.kind === "page" ? "scroll" : "contain", source: sourceLabel(screen.url) };
  if ((screen.kind === "clip" || screen.kind === "broll") && existsSync(`${name}.mp4`)) return { file: `${name}.mp4`, video: true, fit: "cover", source: screen.kind === "clip" ? sourceLabel(screen.url) : "" };
  return undefined;
}

// The largest size within `longest` pixels on its longer side, in even numbers, which ffmpeg needs.
function fitWithin({ width, height }: { width: number; height: number }, longest: number): { width: number; height: number } {
  const scale = longest / Math.max(width, height);
  return { width: Math.round((width * scale) / 2) * 2, height: Math.round((height * scale) / 2) * 2 };
}

function isPullRequestLink(word: string): boolean {
  try {
    parsePullRequestUrl(word);
    return true;
  } catch {
    return false;
  }
}

// The personality to write and act in: a built-in one, one made in Personality Studio, or for an X handle, a style Grok
// reads from its posts.
async function findPersona(personality: string, signal?: AbortSignal): Promise<{ persona: Persona; cost: number }> {
  if (personality.startsWith("@")) {
    const handle = parseHandle(personality);
    if (!handle) throw new Error(`"${personality}" isn't an X handle.`);
    return personaFromX(handle, signal);
  }
  const persona = await findPersonality(personality);
  if (!persona) throw new Error(`Pick a personality, ${(await listPersonalities()).map(({ id }) => id).join(", ")}, or an X handle.`);
  return { persona, cost: 0 };
}

// What a segment's take is filmed from, and the key it's kept under: the presenter, their voice and room, the
// personality's delivery, and what the segment has them say and do.
function takeOf(segment: Segment, presenter: Presenter, delivery: string): { part: Part; green: boolean; room: string; key: string } {
  const part = toPart(segment);
  const green = segment.layout === "green";
  const room = green ? GREEN_ROOM : presenter.room;
  return { part, green, room, key: JSON.stringify([presenter.id, presenter.voice, room, delivery, part]) };
}

// How long each segment's take runs, whether it's filmed already, in this conversation or saved by an earlier one, and
// about what filming the rest would cost, before anything is filmed.
export async function estimateDraft(draft: Draft, presenterId: string, cache: Cache, dir = dirOf(draft.source)): Promise<{ segments: Array<{ seconds: number; filmed: boolean; cost: number }>; cost: number }> {
  const presenter = await findPresenter(presenterId);
  const segments = draft.segments.map((segment) => {
    const { key } = takeOf(segment, presenter, draft.persona.delivery);
    const seconds = lineSeconds(segment.line);
    const filmed = cache.takes.has(key) || existsSync(`${dir}/take-${fingerprint(key)}-a.mp4`);
    return { seconds, filmed, cost: filmed ? 0 : seconds * TAKES_PER_LINE * TAKE_USD_PER_SECOND };
  });
  return { segments, cost: segments.reduce((sum, { cost }) => sum + cost, 0) };
}

// Every take saved for each segment of the draft, in the order they were filmed, and the one the next cut uses, if it's
// known: the one picked by hand, the one filming kept, or the one in the current cut, `used`.
export async function takesOf(draft: Draft, presenterId: string, cache: Cache, used: string[] = [], dir = dirOf(draft.source)): Promise<Array<{ files: string[]; chosen?: string }>> {
  const presenter = await findPresenter(presenterId);
  return draft.segments.map((segment) => {
    const { key } = takeOf(segment, presenter, draft.persona.delivery);
    const files = savedTakes(`${dir}/take-${fingerprint(key)}`);
    return { files, chosen: cache.takes.get(key)?.file ?? cache.choices.get(fingerprint(key)) ?? files.find((file) => used.includes(file)) };
  });
}

// Keeps one of a segment's saved takes for the next cut, instead of the one filming picked.
export async function chooseTake(draft: Draft, presenterId: string, cache: Cache, index: number, file: string, dir = dirOf(draft.source)): Promise<Take> {
  const presenter = await findPresenter(presenterId);
  const segment = draft.segments[index];
  if (!segment) throw new Error("There's no such segment.");
  const { part, green, room, key } = takeOf(segment, presenter, draft.persona.delivery);
  const base = `${dir}/take-${fingerprint(key)}`;
  if (!savedTakes(base).includes(file)) throw new Error("That isn't one of this segment's takes.");
  // Nothing is filmed for a take that's saved already, so the portrait isn't needed.
  const cast = { portrait: new Blob([]), voice: presenter.voice, room, delivery: draft.persona.delivery, green: green ? presenter.green : undefined };
  const take = await recordTake(part, cast, base, () => {}, undefined, { pick: file });
  cache.takes.set(key, take);
  cache.choices.set(fingerprint(key), file);
  return take;
}

// Films more takes of a segment's line with `direction` added, like "more energy", and keeps the best new one for the
// next cut. Its other takes stay, to pick from.
export async function retakeSegment(
  draft: Draft,
  presenterId: string,
  cache: Cache,
  index: number,
  direction: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  dir = dirOf(draft.source),
): Promise<Take> {
  const presenter = await findPresenter(presenterId);
  const segment = draft.segments[index];
  if (!segment) throw new Error("There's no such segment.");
  const { part, green, room, key } = takeOf(segment, presenter, draft.persona.delivery);
  const drawn = await drawPresenter(presenter, signal);
  const pictured = green ? await drawGreenPortrait({ ...presenter, face: drawn.face }, drawn.portrait, signal) : undefined;
  const cast = { portrait: pictured?.portrait ?? drawn.portrait, voice: presenter.voice, room, delivery: draft.persona.delivery, green: pictured?.green };
  const take = await recordTake(part, cast, `${dir}/take-${fingerprint(key)}`, onProgress, signal, { more: direction });
  cache.takes.set(key, take);
  cache.choices.set(fingerprint(key), take.file);
  return take;
}

function toPart({ line, mood, screen, acting }: Segment): Part {
  return { line, mood, pointAt: POINT_AT[screen.kind], acting: acting || undefined };
}

// The pill at the top of the video: the repository and number of a pull request, or the title of a video about an idea.
function tagOf({ source, title }: Draft): string {
  return "pr" in source ? `${source.pr.repo}  #${source.pr.number}` : title;
}

// A folder for each pull request, or for each idea, named after its first words.
// The folder in output/ that everything made for a video is saved in.
export function dirOf(source: Source): string {
  return `output/${folderOf(source)}`;
}

function folderOf(source: Source): string {
  if ("pr" in source) return slugify(`${source.pr.repo}-${source.pr.number}`);
  const slug = slugify(source.idea);
  return slug.length <= 48 ? slug : slug.slice(0, 49).replace(/-[^-]*$/, "");
}

// What's drawn for each segment, with the rows of the pull request's diff and the pictures and screenshots filled in.
// A video is read frame by frame while the video is put together.
async function toCards({ source, title, segments }: Draft, media: Array<Media | undefined>): Promise<Card[]> {
  const pr = "pr" in source ? source.pr : undefined;
  return Promise.all(
    segments.map(async ({ label, emoji, screen }, index): Promise<Card> => {
      if (isMedia(screen)) {
        const got = media[index];
        const image = got && !got.video ? await loadImage(await readFile(got.file)) : undefined;
        return { kind: "media", label, emoji, source: got?.source ?? "", fit: got?.fit ?? "cover", image };
      }
      if (screen.kind === "stamp") {
        const note = pr ? `+${pr.additions} −${pr.deletions} · ${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}` : "";
        return { kind: "stamp", text: screen.text, emoji, note };
      }
      if (screen.kind === "headline" || !pr) return { kind: "headline", emoji, title };
      if (screen.kind === "pull-request") return { kind: "pull-request", emoji, pr };
      const rows = pr.files.find((file) => file.path === screen.file)?.rows ?? [];
      return { kind: "code", label, emoji, file: screen.file, rows, from: screen.from, to: screen.to };
    }),
  );
}

// The takes are cut to their words and played one after another, so each segment starts where the one before it ends.
// Each cut is a whole number of frames long, for the sound as well as the picture, so the lips stay in sync to the end.
function toTimeline(segments: Segment[], takes: Take[]): Timeline {
  const timeline: Timeline = { duration: 0, parts: [], words: [] };
  takes.forEach((take, index) => {
    const { kind, line, mood, layout } = segments[index];
    const start = timeline.duration;
    line.split(/\s+/).filter(Boolean).forEach((text, each) => {
      timeline.words.push({ text, start: start + Math.max(0, take.words[each] - take.start), part: index });
    });
    timeline.duration += cutLength(take);
    timeline.parts.push({ kind, start, end: timeline.duration, mood, layout });
  });
  return timeline;
}

// A take with `trim` cut from its start and end as well, or kept, always within the take and at least half a second long.
function trimmed(take: Take, trim?: Trim): Take {
  if (!trim) return take;
  const start = Math.min(Math.max(0, take.start + trim.head), take.end - 0.5);
  const end = Math.max(Math.min(take.seconds, take.end - trim.tail), start + 0.5);
  return { ...take, start, end };
}

function cutLength(take: Take): number {
  return Math.round((take.end - take.start) * FPS) / FPS;
}

// Joins the takes into one video at the frame rate of the finished video, keeping only the part of each take with its words,
// with `tail` seconds of black and silence after, for an end card.
async function cutTakes(takes: Take[], out: string, signal?: AbortSignal, tail = 0): Promise<void> {
  const trims = takes.map((take, index) => {
    const end = take.start + cutLength(take);
    return [
      `[${index}:v]trim=start=${take.start}:end=${end},setpts=PTS-STARTPTS,fps=${FPS},scale=${TAKE_WIDTH}:${TAKE_HEIGHT},setsar=1[v${index}]`,
      `[${index}:a]atrim=start=${take.start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000[a${index}]`,
    ].join(";");
  });
  const padded = tail ? `[joined]tpad=stop_mode=add:stop_duration=${tail}:color=black[v];[heard]apad=pad_dur=${tail}[a]` : "[joined]null[v];[heard]anull[a]";
  const concat = `${takes.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${takes.length}:v=1:a=1[joined][heard];${padded}`;
  await run(
    "ffmpeg",
    [
      "-y", "-v", "error",
      ...takes.flatMap((take) => ["-i", take.file]),
      "-filter_complex", [...trims, concat].join(";"),
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", out,
    ],
    { signal },
  );
}

// Reads the cut one frame at a time from one ffmpeg, draws the finished frame over it in `theme`, with the title and the
// labels only if `onScreen` says so, and pipes that to another ffmpeg, which encodes it with the cut's sound and the
// sound effects. During green screen segments, the decoder
// keys out the green, `green` as hex, so the presenter comes out over a transparent background. `clips` has the video, if
// any, that each segment shows.
async function compose(
  tag: string,
  cards: Card[],
  timeline: Timeline,
  face: { x: number; y: number },
  theme: Theme,
  onScreen: OnScreen,
  green: string | undefined,
  clips: Array<{ file: string; size: { width: number; height: number } } | undefined>,
  cut: string,
  out: string,
  onProgress: FilmEvents["progress"],
  signal?: AbortSignal,
  marks?: Marks,
  sound: { effects: boolean; music?: { file: string; volume: number } } = { effects: true },
): Promise<void> {
  const effects = mixSound(timeline, sound.effects, sound.music);
  const keyed = timeline.parts.filter((part) => part.layout === "green").map((part) => `between(t,${part.start.toFixed(3)},${part.end.toFixed(3)})`);
  const key = green && keyed.length ? ["-vf", `chromakey=0x${green}:${KEY.similarity}:${KEY.blend}:enable='${keyed.join("+")}',despill=type=green:enable='${keyed.join("+")}'`] : [];
  const decoder = spawn("ffmpeg", ["-v", "error", "-i", cut, ...key, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { signal, stdio: ["ignore", "pipe", "pipe"] });
  const encoder = spawn(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${WIDTH}x${HEIGHT}`, "-r", String(FPS), "-i", "pipe:0",
      "-i", cut,
      ...effects.inputs,
      "-filter_complex", effects.filter,
      "-map", "0:v", "-map", "[audio]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out,
    ],
    { signal, stdio: ["pipe", "ignore", "pipe"] },
  );
  const finished = [decoder, encoder].map((child) => {
    let errors = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (errors += chunk));
    const exit = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg couldn't make the video: ${errors.trim()}`))));
    });
    // They're awaited below, unless drawing fails first, and then both are stopped and their results don't matter.
    exit.catch(() => {});
    return exit;
  });
  // If the encoder stops reading early, its exit code and error output say why.
  encoder.stdin.on("error", () => {});
  const players = new Map<number, ReturnType<typeof clipPlayer>>();

  try {
    const draw = frameDrawer(tag, cards, timeline, face, theme, onScreen, marks);
    const frames = Math.round(timeline.duration * FPS);
    let frame = 0;
    for await (const pixels of readFrames(decoder.stdout, TAKE_WIDTH * TAKE_HEIGHT * 4)) {
      const index = Math.max(0, timeline.parts.findLastIndex((part) => part.start <= frame / FPS));
      const clip = clips[index];
      const part = timeline.parts[index];
      if (clip && !players.has(index)) players.set(index, clipPlayer(clip.file, clip.size, Math.ceil((part.end - part.start) * FPS) + 1, signal));
      const video = await players.get(index)?.next();
      if (!encoder.stdin.write(draw(frame, pixels, video))) await Promise.race([once(encoder.stdin, "drain"), finished[1]]);
      if (++frame % 15 === 0) onProgress?.(Math.min(frame, frames), frames);
    }
    encoder.stdin.end();
    await Promise.all(finished);
    onProgress?.(frames, frames);
  } finally {
    for (const child of [decoder, encoder]) if (child.exitCode === null) child.kill();
    for (const player of players.values()) player.stop();
  }
}

// Plays a segment's video in step with the cut, one frame of the clip for each frame of the segment, at the frame rate of
// the finished video, and decodes no more frames than the segment shows. If the clip runs out before the segment does,
// its last frame stays on screen. ffmpeg waits out a polite stop while it's blocked writing frames nobody reads, so a
// player that's stopped early closes the pipe and is killed outright.
function clipPlayer(file: string, { width, height }: { width: number; height: number }, count: number, signal?: AbortSignal) {
  const decoder = spawn(
    "ffmpeg",
    ["-v", "error", "-i", file, "-an", "-vf", `fps=${FPS},scale=${width}:${height}`, "-frames:v", String(count), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { signal, stdio: ["ignore", "pipe", "ignore"] },
  );
  decoder.on("error", () => {});
  const frames = readFrames(decoder.stdout, width * height * 4);
  const canvas = createCanvas(width, height);
  let last: Canvas | undefined;
  return {
    async next(): Promise<Canvas | undefined> {
      const { value, done } = await frames.next();
      if (done) return last;
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(value.buffer, value.byteOffset, value.length), width, height), 0, 0);
      last = canvas;
      return canvas;
    },
    stop() {
      decoder.stdout.destroy();
      if (decoder.exitCode === null) decoder.kill("SIGKILL");
    },
  };
}

// The decoder writes raw pixels in chunks of any size, and this hands them on one frame at a time.
async function* readFrames(stream: Readable, size: number): AsyncGenerator<Uint8Array> {
  let chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    length += chunk.length;
    if (length < size) continue;
    let pending = Buffer.concat(chunks, length);
    while (pending.length >= size) {
      yield pending.subarray(0, size);
      pending = pending.subarray(size);
    }
    chunks = pending.length ? [pending] : [];
    length = pending.length;
  }
}

// The sound of the finished video: the presenter, over the sound effects, if they're on, and the music, if there is any,
// all evened out to the loudness short video apps play at, -14 LUFS.
//
// The effects are a boom whenever the presenter is shocked, a whoosh on every cut, and a bell for the last segment. ffmpeg
// makes them from formulas and from noise, so the app needs no sound files. Each one is delayed to its moment. The music
// loops for as long as the video runs, fades in and out, and dips whenever the presenter speaks, so it never covers them.
function mixSound(timeline: Timeline, effects: boolean, music?: { file: string; volume: number }): { inputs: string[]; filter: string } {
  const inputs: string[] = [];
  const chains: string[] = [];
  const mix = [music ? "[voice]" : "[1:a]"];
  const add = (source: string, times: number[], volume: number) => {
    if (!times.length || !effects) return;
    const input = 2 + inputs.length / 4;
    inputs.push("-f", "lavfi", "-i", source);
    const copies = times.map((_, index) => `[fx${input}c${index}]`);
    chains.push(`[${input}:a]volume=${volume},asplit=${times.length}${copies.join("")}`);
    times.forEach((time, index) => {
      chains.push(`${copies[index]}adelay=${Math.round(time * 1000)}:all=1[fx${input}d${index}]`);
      mix.push(`[fx${input}d${index}]`);
    });
  };
  add(
    "aevalsrc=(sin(2*PI*55*t)+0.5*sin(2*PI*110*t)+0.4*(2*random(0)-1)*exp(-40*t))*exp(-3.5*t):s=48000:d=1.2",
    timeline.parts.filter((part) => part.mood === "shocked").map((part) => part.start),
    0.4,
  );
  add(
    "anoisesrc=d=0.45:c=pink:r=48000:a=0.5,bandpass=f=1500:width_type=o:w=2,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.25",
    timeline.parts.slice(1).map((part) => Math.max(0, part.start - 0.15)),
    0.35,
  );
  // A bell as the last segment is stamped on.
  add("aevalsrc=(sin(2*PI*1318.5*t)+0.6*sin(2*PI*1975.5*t))*exp(-5*t):s=48000:d=1.2", [timeline.parts.at(-1)!.start], 0.2);
  if (music) {
    const input = 2 + inputs.length / 4;
    // The music is evened out first, so a quiet song and a loud one sit at the same level: about 11 dB under the voice at
    // the middle volume, and twice that while the presenter speaks.
    const gain = 0.1 + 0.5 * music.volume;
    inputs.push("-stream_loop", "-1", "-i", music.file);
    chains.push(
      "[1:a]asplit=2[voice][key]",
      `[${input}:a]atrim=0:${timeline.duration.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-2,aresample=48000,volume=${gain.toFixed(3)},afade=t=in:d=1,afade=t=out:st=${Math.max(0, timeline.duration - 2).toFixed(3)}:d=2[bed]`,
      "[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]",
    );
    mix.push("[ducked]");
  }
  chains.push(`${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[audio]`);
  return { inputs, filter: chains.join(";") };
}

// The script as Markdown, to paste under the video, like into the pull request it explains.
export function transcriptOf({ title, segments }: Pick<Draft, "title" | "segments">): string {
  const blocks = segments.map(({ kind, label, emoji, line, screen }) => {
    if (kind === "hook") return `> ${line} ${emoji}`;
    const where = screen.kind === "code" ? ` \`${screen.file}\`` : "url" in screen ? ` (${screen.url})` : "";
    if (kind === "beat") return `- **${label}** ${emoji}${where}: ${line}`;
    if (kind === "ending") return `**${label}** ${emoji} ${line}`;
    return line;
  });
  return `## ${title}\n\n${blocks.join("\n\n")}\n`;
}

// A short name for a file, made from what it was made from, so that a take or picture made again gets the same name.
function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 10);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
}
