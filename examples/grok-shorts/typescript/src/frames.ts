import { type Canvas, GlobalFonts, type Image, ImageData, type SKRSContext2D, createCanvas } from "@napi-rs/canvas";
import { FONT_FILES } from "./brand.ts";
import type { PullRequest, Row } from "./github.ts";
import type { Layout, Mood, Segment } from "./script.ts";
import { type Style, type Theme, inkOn } from "./themes.ts";

for (const { file } of FONT_FILES) GlobalFonts.registerFromPath(file);

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
// The size Grok Imagine renders the takes at.
export const TAKE_WIDTH = 720;
export const TAKE_HEIGHT = 1280;

// When everything in the video happens, in seconds from its start: each segment, in order, with how it's framed, and
// each word of the script, with the time it's said and the segment it's in. A segment with a `lead` starts with that
// many seconds of its clip playing with its own sound, with the presenter under it watching and reacting if they
// `react`, and the words heard in the clip are there too, marked `clip`.
export type Timeline = {
  duration: number;
  parts: Array<{ kind: Segment["kind"]; start: number; end: number; mood: Mood; layout: Layout; lead?: number; react?: boolean }>;
  words: Array<{ text: string; start: number; part: number; clip?: boolean }>;
};
// What's drawn for each segment, in the same order as the timeline's parts: the hook in huge letters, the pull request,
// rows of a file's diff, a picture, screenshot, or video, or a stamp with a note under it. A media card's video comes in
// frame by frame. A screenshot taller than its space scrolls, and a post is shown whole. A `graphic` is rendered at the
// size of its spot, so it's never laid over the presenter anywhere smaller.
export type Card =
  | { kind: "headline"; emoji: string }
  | { kind: "pull-request"; pr: PullRequest }
  | { kind: "code"; file: string; rows: Row[]; from: number; to: number }
  | { kind: "media"; emoji: string; fit: "cover" | "contain" | "scroll"; image?: Image; graphic?: boolean }
  | { kind: "stamp"; text: string; emoji: string; note: string };
type Box = { x: number; y: number; width: number; height: number };
// How a segment's words look: its color from the theme, the color of words on that color, the font for big words, the
// color of caption words that aren't being said, and the color to glow in, if they glow.
type Paint = { color: string; ink: string; font: string; text: string; glow?: string; style: Style };

// Canvas uses the first font in a list that's installed, and takes any character that font lacks from the fonts after
// it, which is how the emoji get drawn. Generic names like monospace don't reliably pick the right kind of font, so each
// list names the usual fonts on macOS, Windows, and Linux.
const EMOJI = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK JP"`;
const SANS = `"Helvetica Neue", "Segoe UI", "DejaVu Sans", Arial, ${EMOJI}`;
const MONO = `Menlo, Consolas, "DejaVu Sans Mono", ${EMOJI}`;
// In a split, the top of the frame shows what the segment is about, edge to edge, and the bottom shows the presenter, so
// it never covers their face.
export const SPLIT = 880;
// The presenter's face sits this far down the bottom of the frame in every cut, whoever the presenter is, low enough that
// their head stays under the captions even when they lean into the camera.
const FACE_AT = 0.62;
const CARD = { x: 50, y: 130, width: WIDTH - 100, height: 710 };
const FULL = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
// The apps draw their tabs and search over about this much of the top of a short, so what fills the top of the frame
// starts what matters under it.
const APP_BAR = 150;
// The hook or the ending in the top of a split.
const WORDS_BOX = { x: 50, y: APP_BAR, width: WIDTH - 100, height: SPLIT - APP_BAR - 30 };
// With the presenter filling the screen, words go above their head, where every portrait leaves room.
const TOP = { x: 50, y: 130, width: WIDTH - 100, height: 470 };
// Laid over the presenter's video, a visual goes above their head, covering their hair at most, and under the apps' top
// bar.
export const OVER = { x: 60, y: 168, width: WIDTH - 120, height: 500 };
// A diff or a pull request laid over the presenter's video is drawn this tall at the frame's full width, then scaled
// down into its spot.
const PANEL_HEIGHT = 640;
// A post is shown whole, with room around it, and so is anything that isn't tall, like a landscape or square clip,
// across the middle of the screen, where a square one fills the width.
const POST_ALONE = { x: 60, y: 220, width: WIDTH - 120, height: 1250 };
const WIDE_ALONE = { x: 0, y: 460, width: WIDTH, height: 1000 };
// A diff's colors, the way GitHub's dark theme draws one in its editor.
const EDITOR = { background: "#0d1117", bar: "#010409", line: "#30363d", dim: "#7d8590", text: "#e6edf3", prose: "#c9d1d9", added: "rgb(46 160 67 / 0.2)", removed: "rgb(248 81 73 / 0.2)", plus: "#3fb950", minus: "#f85149", hunk: "#79c0ff" };
// How the presenter is framed: how much closer than the whole take, and which third of the frame their face is in, -1
// for the left, 0 for the middle, and 1 for the right. Every cut changes the shot, the way creators cut their own videos,
// taking these in turn.
type Shot = { zoom: number; side: number };
const SHOTS: Shot[] = [
  { zoom: 1.16, side: 0 },
  { zoom: 1.3, side: -1 },
  { zoom: 1, side: 0 },
  { zoom: 1.16, side: 1 },
  { zoom: 1.3, side: 0 },
  { zoom: 1.16, side: -1 },
];
// How far off the middle a face in a side third of the frame sits, as a share of the frame's width.
const THIRD = 0.14;
// Where a visual laid over the presenter's video goes, and the third of the frame their face moves to, to make room.
type Placement = { box: Box; side: number };
// The presenter's shot at a moment of a segment, how many seconds it's been held, and how the segment's mood moves it.
type Framing = { shot: Shot; mood: Mood; since: number; held: number; t: number };
// Captions stay out from under what the apps draw over a short: above the bottom fifth of the frame, where YouTube
// Shorts, TikTok, and Reels put their own caption and title, and in the middle, clear of their buttons on the right.
const CAPTION_Y = 1460;
const CAPTION_WIDTH = WIDTH - 340;
// With the presenter in the bottom of the frame, in a split or in front of a green screen, the captions' tops go just
// under the card, clear of the presenter's head even as they lean in, since down at CAPTION_Y they'd cover their face.
const SEAM_TOP = CARD.y + CARD.height + 18;
const CAPTION_WORDS = 3;
// Long words shrink a caption to fit its line, but no smaller than this: a word that would make it smaller starts the
// next caption instead, so captions stay about the same size.
const CAPTION_SMALLEST = 64;
const CURRENT_SCALE = 1.12;

type Caption = { words: Timeline["words"]; part: number };

// What a brand kit puts on a video: its logo in the top right corner of every frame, with `watermark`, and an end card
// after the last line, with its logo, name, and call to action.
export type Marks = { logo?: Image; watermark: boolean; endCard?: { name: string; line: string } };

// Returns a function that draws one frame of the finished video from the same frame of the cut, and returns its pixels,
// which ffmpeg reads as raw video. `cards` has a card for each part of the timeline, `face` is where the presenter's
// face is in their portrait, as a share of its width and height, and `theme` colors the words. `video` is the frame of a
// media card's video for this frame of the cut, if it has one. In a green screen segment, the take arrives with the
// green already keyed out. `marks` are the brand kit's, if any.
export function frameDrawer(cards: Card[], timeline: Timeline, face: { x: number; y: number }, theme: Theme, marks?: Marks): (frame: number, take: Uint8Array, video?: Canvas) => Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const take = createCanvas(TAKE_WIDTH, TAKE_HEIGHT);
  const panel = createCanvas(WIDTH, PANEL_HEIGHT);
  const font = paintOf(theme, 0).font;
  const captions = toCaptions(timeline, (texts) => captionWidth(ctx, texts, CAPTION_SMALLEST, font) <= CAPTION_WIDTH);
  const small = (card: Card) => card.kind === "media" && card.fit === "cover" && !card.graphic;
  const placements = timeline.parts.map((part, index) => (part.layout === "overlay" && !isWords(cards[index]) ? placementOf(timeline.parts, index, small(cards[index])) : undefined));
  const shots = shotsOf(timeline, placements);
  const entrances = timeline.parts.map((_, index) => entranceOf(timeline, index));
  const lastLine = timeline.parts.at(-1)?.end ?? timeline.duration;
  const logo = marks?.watermark && marks.logo ? watermarkOf(marks.logo) : undefined;
  return (frame, pixels, video) => {
    const t = frame / FPS;
    if (marks?.endCard && t >= lastLine) {
      drawEndCard(ctx, marks.endCard, marks.logo, t - lastLine, paintOf(theme, 0));
      return canvas.data();
    }
    const index = Math.max(0, timeline.parts.findLastIndex((part) => part.start <= t));
    const part = timeline.parts[index];
    const card = cards[index];
    const paint = paintOf(theme, index);
    // A segment's own time starts when the presenter starts the line, after any clip that plays before it.
    const lead = part.lead ?? 0;
    const since = t - part.start - lead;
    const length = part.end - part.start - lead;
    take.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), TAKE_WIDTH, TAKE_HEIGHT), 0, 0);
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const cut = shots[index].findLast((each) => each.at <= since) ?? shots[index][0];
    const framing = { shot: cut.shot, mood: part.mood, since, held: since - cut.at, t };
    // Until the visual's entrance, a moment into the segment, the presenter has the screen.
    const shown = since - entrances[index];

    if (since < 0 && part.react) {
      // A clip playing with its own sound before the line, with the presenter watching it and reacting, in a wide shot the
      // line cuts in from: keyed out in front of it in a green screen segment, and otherwise under it.
      const reacting = { shot: { zoom: 1, side: 0 }, mood: "chill" as const, since: since + lead, held: since + lead, t };
      if (part.layout === "green") drawScreen(ctx, card, video, SPLIT, since + lead, lead, paint);
      else drawTop(ctx, card, video, timeline, index, t, since + lead, lead, paint, paintOf(theme, 0));
      drawPresenter(ctx, take, face, reacting, part.layout !== "green");
    } else if (since < 0) {
      // With no reaction, the clip fills the screen on its own.
      drawScreen(ctx, card, video, HEIGHT, since + lead, lead, paint);
    } else if (part.layout === "split") {
      // A clip that played before the line keeps easing in from where it was.
      drawTop(ctx, card, video, timeline, index, t, since + lead, length + lead, paint, paintOf(theme, 0));
      drawPresenter(ctx, take, face, framing, true);
    } else if (isWords(card) || part.layout === "full" || shown < 0) {
      drawFull(ctx, take, face, framing);
      if (isWords(card)) shade(ctx, 0, TOP.y + TOP.height + 120);
      if (card.kind === "headline") drawHook(ctx, card, timeline, index, t, since, TOP, paint);
      else if (card.kind === "stamp") drawStamp(ctx, card, since, TOP, paintOf(theme, 0));
    } else if (part.layout === "overlay") {
      drawFull(ctx, take, face, framing);
      drawOverlay(ctx, card, video, panel, placements[index] ?? { box: OVER, side: 0 }, shown, length, paint);
    } else {
      // The visual fills the screen, with the presenter keyed out in front of it, covering the bottom of it, or not at all.
      const green = part.layout === "green";
      drawScreen(ctx, card, video, green ? SPLIT : HEIGHT, shown + lead, length + lead, paint);
      if (green) drawPresenter(ctx, take, face, framing, false);
    }

    if (logo) ctx.drawImage(logo, WIDTH - 50 - logo.width + LOGO.shadow, LOGO.top + (LOGO.height - logo.height) / 2);
    const framedAs = since >= 0 ? part.layout : !part.react ? "visual" : part.layout === "green" ? "green" : "split";
    if (part.kind !== "hook") drawCaption(ctx, captions, index, t, paint, captionY(framedAs, paint.style.caption));
    return canvas.data();
  };
}

// The biggest a logo is drawn in the top right corner, and the room around it for its shadow.
const LOGO = { width: 220, height: 56, top: 56, shadow: 12 };

// The logo at its size in the corner, with a soft shadow so it shows on light frames too, drawn once: a shadow drawn on
// every frame would slow the whole video down.
function watermarkOf(logo: Image): Canvas {
  const scale = Math.min(LOGO.width / logo.width, LOGO.height / logo.height);
  const [width, height] = [Math.round(logo.width * scale), Math.round(logo.height * scale)];
  const stamp = createCanvas(width + LOGO.shadow * 2, height + LOGO.shadow * 2);
  const ctx = stamp.getContext("2d");
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "rgb(0 0 0 / 0.35)";
  ctx.shadowBlur = LOGO.shadow;
  ctx.drawImage(logo, LOGO.shadow, LOGO.shadow, width, height);
  return stamp;
}

// The end card, after the last line: the logo, the brand's name, and its call to action in the brand's first color,
// easing in over a dark background.
function drawEndCard(ctx: SKRSContext2D, card: { name: string; line: string }, logo: Image | undefined, since: number, paint: Paint): void {
  const p = easeOut(clamp(since / 0.45, 0, 1));
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.globalAlpha = p;
  ctx.translate(WIDTH / 2, HEIGHT / 2);
  ctx.scale(0.94 + 0.06 * p, 0.94 + 0.06 * p);
  ctx.translate(-WIDTH / 2, -HEIGHT / 2);
  let y = logo ? 640 : 820;
  if (logo) {
    const scale = Math.min(560 / logo.width, 320 / logo.height);
    const [width, height] = [logo.width * scale, logo.height * scale];
    ctx.drawImage(logo, (WIDTH - width) / 2, y + (320 - height) / 2, width, height);
    y += 400;
  }
  ctx.textAlign = "center";
  if (card.name) {
    ctx.font = `900 ${logo ? 64 : 96}px ${paint.font}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(fitText(ctx, card.name, WIDTH - 160), WIDTH / 2, y + 60);
    y += logo ? 120 : 160;
  }
  if (card.line) {
    ctx.font = `800 48px ${paint.font}`;
    const shown = fitText(ctx, card.line, WIDTH - 200);
    const width = ctx.measureText(shown).width + 80;
    ctx.fillStyle = paint.color;
    ctx.beginPath();
    ctx.roundRect((WIDTH - width) / 2, y, width, 96, 48);
    glowing(ctx, paint.glow, 30, () => ctx.fill());
    ctx.fillStyle = paint.ink;
    ctx.fillText(shown, WIDTH / 2, y + 64);
  }
  ctx.restore();
}

// A segment takes the next of the theme's colors, so the colors change from segment to segment.
function paintOf(theme: Theme, part: number): Paint {
  const color = theme.colors[part % theme.colors.length];
  return { color, ink: inkOn(color), font: `${theme.font}, ${EMOJI}`, text: theme.text, glow: theme.glow ? color : undefined, style: theme.style };
}

// Moves what's drawn next into place over its first moments, the way the theme's motion says: sliding in from the left,
// popping up from small, or dropping in from above with a tilt. `x` and `y` are the point it grows and turns around.
function enter(ctx: SKRSContext2D, motion: Style["motion"], since: number, x: number, y: number): void {
  const p = clamp(since / 0.3, 0, 1);
  if (p >= 1) return;
  if (motion === "slide") ctx.translate(-(1 - easeOut(p)) * 420, 0);
  if (motion === "pop") {
    const scale = 0.6 + 0.4 * easeOutBack(p);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
  }
  if (motion === "drop") {
    ctx.translate(0, -(1 - easeOutBack(p)) * 160);
    ctx.translate(x, y);
    ctx.rotate((1 - p) * -0.12);
    ctx.translate(-x, -y);
  }
  ctx.globalAlpha *= Math.min(1, p * 2.5);
}

// What's at a point of a frame, as a share of its width and height, in a segment of `kind` framed by `layout`, for a note
// about it: the captions, the presenter, or what the segment shows, named in `shows`. `since` is how far into the
// segment the frame is. For its first `lead` seconds, its clip plays, and if they `react`, the presenter watches it from
// the bottom of the frame, under it or keyed out in front of it, and after that, until the visual's `entrance`, the
// presenter has the screen. A visual laid over them is in `spot`.
export function spotAt(
  kind: Segment["kind"],
  layout: Layout,
  shows: string,
  x: number,
  y: number,
  { since = Number.POSITIVE_INFINITY, lead = 0, react = false, entrance = 0, spot = OVER }: { since?: number; lead?: number; react?: boolean; entrance?: number; spot?: Box } = {},
): string {
  const [left, top] = [x * WIDTH, y * HEIGHT];
  const words = kind === "hook" || kind === "ending";
  if (since < lead) {
    if (react ? top > SEAM_TOP && top < SEAM_TOP + 140 : top > CAPTION_Y - 110 && top < CAPTION_Y + 50) return "the captions of what's said in the clip";
    return react && top >= SPLIT ? "the presenter, reacting to the clip" : shows;
  }
  const seam = layout === "split" || layout === "green";
  if (kind !== "hook" && (seam ? top > SEAM_TOP && top < SEAM_TOP + 140 : top > CAPTION_Y - 110 && top < CAPTION_Y + 50)) return "the captions";
  if (layout === "split") return top >= SPLIT ? "the presenter" : shows;
  if (!words && since - lead < entrance) return "the presenter";
  if (layout === "overlay" && !words) return left >= spot.x && left <= spot.x + spot.width && top >= spot.y && top <= spot.y + spot.height ? shows : "the presenter";
  if (layout === "full" || words) return words && top <= TOP.y + TOP.height ? shows : "the presenter";
  if (layout === "green" && top >= SPLIT) return `the presenter, in front of ${shows}`;
  return shows;
}

// When the visual comes on screen in a segment, in seconds into it. A visual that fills the screen cuts in on the third
// word, after the presenter starts the line on camera, and one laid over their video drops in on the second, the way an
// editor cuts on words instead of at the start of every take. A short segment shows it from the start.
export function entranceOf(timeline: Pick<Timeline, "parts" | "words">, index: number): number {
  const part = timeline.parts[index];
  if (part.kind === "hook" || part.kind === "ending") return 0;
  const begins = part.start + (part.lead ?? 0);
  const fills = part.layout === "visual";
  const words = timeline.words.filter((word) => word.part === index && !word.clip);
  const word = fills ? words[2] : part.layout === "overlay" ? words[1] : undefined;
  if (!word || part.end - begins < (fills ? 2.6 : 2)) return 0;
  return Math.min(fills ? 0.9 : 0.6, Math.max(0, word.start - begins));
}

// Where a visual laid over the presenter's video goes. Overlays take turns through a video, so they don't all land in the
// same spot: above the presenter's head, across the frame; smaller, in a top corner, with their face in the other third;
// and beside their head, with their face in the other third. Only a visual that still reads `small`, like a picture or
// a clip, goes in a corner or beside them: a screenshot, a post, or code goes above the head, the only spot big enough
// to read it in.
export function placementOf(parts: Timeline["parts"], index: number, small: boolean): Placement {
  const nth = parts.slice(0, index).filter((part) => part.layout === "overlay" && part.kind !== "hook" && part.kind !== "ending").length;
  const corner = Math.floor(nth / 3) % 2 ? -1 : 1;
  if (!small || nth % 3 === 0) return { box: OVER, side: 0 };
  if (nth % 3 === 1) return { box: { x: corner > 0 ? WIDTH - 600 : 40, y: 190, width: 560, height: 520 }, side: -corner };
  return { box: { x: corner > 0 ? WIDTH - 500 : 40, y: 420, width: 460, height: 720 }, side: -corner };
}

// The shots in each segment, with when each one starts, in seconds into the segment. Each segment takes the next shot in
// turn, a shocked one is close, and one with a visual in a corner or beside the presenter moves their face to the other
// third, close enough that the face can go there. At each sentence break in a line, the shot cuts in, then back out at
// the next, and a long line of one sentence cuts in once, partway through. A close shot cuts back out instead, unless
// its face has to stay in its third.
function shotsOf(timeline: Timeline, placements: Array<Placement | undefined>): Array<Array<{ at: number; shot: Shot }>> {
  return timeline.parts.map((part, index) => {
    const turn = SHOTS[index % SHOTS.length];
    const placed = placements[index];
    const own = part.mood === "shocked" ? { zoom: 1.3, side: 0 } : placed?.side ? { zoom: 1.3, side: placed.side } : placed ? { zoom: turn.zoom, side: 0 } : turn;
    const closer = { zoom: placed?.side ? 1.42 : own.zoom >= 1.3 ? 1.16 : own.zoom + 0.14, side: own.side };
    const begins = part.start + (part.lead ?? 0);
    const words = timeline.words.filter((word) => word.part === index && !word.clip);
    const length = part.end - begins;
    const breaks = words.flatMap((word, at) => (at > 0 && /[.!?]["')\]]*$/.test(words[at - 1].text) ? [word.start - begins] : []));
    const middle = words[Math.round(words.length * 0.55)];
    const cuts = breaks.length ? breaks : length > 4 && words.length > 8 && middle ? [middle.start - begins] : [];
    return [{ at: 0, shot: own }, ...cuts.filter((at) => at > 1 && at < length - 0.8).map((at, n) => ({ at, shot: n % 2 ? own : closer }))];
  });
}

function isWords(card: Card): card is Extract<Card, { kind: "headline" | "stamp" }> {
  return card.kind === "headline" || card.kind === "stamp";
}

function isPanel(card: Card): card is Extract<Card, { kind: "code" | "pull-request" }> {
  return card.kind === "code" || card.kind === "pull-request";
}

// Where the captions' baseline goes. Under the card, it's as far below SEAM_TOP as the caption's letters are tall at
// their biggest, 132 pixels for one word on its own and 92 for a few.
function captionY(layout: Layout, style: Style["caption"]): number {
  if (layout !== "split" && layout !== "green") return CAPTION_Y;
  return SEAM_TOP + (style === "single" ? 132 : 92) * 0.84;
}

// A dark gradient down from the top of the frame, so words over a picture or the presenter stay readable.
function shade(ctx: SKRSContext2D, from: number, to: number): void {
  const gradient = ctx.createLinearGradient(0, from, 0, to);
  gradient.addColorStop(0, "rgb(0 0 0 / 0.6)");
  gradient.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, from, WIDTH, to - from);
}

// The presenter in the bottom of the frame, in the segment's shot, with the face kept at the same height. In a split, a
// soft edge separates them from what's above. In front of a green screen, where the take has no background, the take
// moves down past its top edge when that's what keeps the face at FACE_AT.
function drawPresenter(ctx: SKRSContext2D, take: Canvas, face: { x: number; y: number }, { shot, mood, since, held, t }: Framing, seam: boolean): void {
  const { zoom, shake } = motion(shot.zoom, mood, since, held);
  const height = HEIGHT - SPLIT;
  const scale = (WIDTH / TAKE_WIDTH) * zoom;
  const width = WIDTH / scale;
  const tall = height / scale;
  const x = clamp(face.x * TAKE_WIDTH - width * (0.5 + shot.side * THIRD) + Math.sin(t * 90) * 8 * shake, 0, TAKE_WIDTH - width);
  const y = clamp(face.y * TAKE_HEIGHT - FACE_AT * tall + Math.cos(t * 70) * 6 * shake, seam ? 0 : -tall / 2, TAKE_HEIGHT - tall);
  const above = Math.max(0, -y);
  ctx.drawImage(take, x, y + above, width, tall - above, 0, SPLIT + above * scale, WIDTH, height - above * scale);
  if (!seam) return;
  const gradient = ctx.createLinearGradient(0, SPLIT, 0, SPLIT + 90);
  gradient.addColorStop(0, "rgb(0 0 0 / 0.55)");
  gradient.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, SPLIT, WIDTH, 90);
}

// The presenter filling the screen, in the segment's shot.
function drawFull(ctx: SKRSContext2D, take: Canvas, face: { x: number; y: number }, { shot, mood, since, held, t }: Framing): void {
  const { zoom, shake } = motion(shot.zoom, mood, since, held);
  const scale = (HEIGHT / TAKE_HEIGHT) * zoom;
  const width = WIDTH / scale;
  const tall = HEIGHT / scale;
  const x = clamp(face.x * TAKE_WIDTH - width * (0.5 + shot.side * THIRD) + Math.sin(t * 90) * 8 * shake, 0, TAKE_WIDTH - width);
  const y = clamp(face.y * TAKE_HEIGHT - 0.55 * tall + Math.cos(t * 70) * 6 * shake, 0, TAKE_HEIGHT - tall);
  ctx.drawImage(take, x, y, width, tall, 0, 0, WIDTH, HEIGHT);
}

// How close a shot is at a moment: its own zoom, creeping closer for as long as it's `held`, and for a shocked part, a
// quick punch in with a shake as it lands.
function motion(zoom: number, mood: Mood, since: number, held: number): { zoom: number; shake: number } {
  let closer = zoom + 0.04 * Math.min(1, held / 4);
  let shake = 0;
  if (mood === "shocked" && since < 0.4) {
    shake = 1 - since / 0.4;
    closer += 0.22 * shake;
  }
  return { zoom: closer, shake };
}

// The hook in huge letters in `box`, each word lighting up as it's said the theme's way, in its color, over a highlighter
// stroke of it, or in a box of it, with a shake as it lands.
function drawHook(ctx: SKRSContext2D, card: Extract<Card, { kind: "headline" }>, timeline: Timeline, part: number, t: number, since: number, box: Box, paint: Paint): void {
  const words = timeline.words.filter((word) => word.part === part);
  const tokens = [...words.map((word) => display(word.text)), card.emoji].filter(Boolean);
  const current = words.findLastIndex((word) => word.start <= t);
  const shake = Math.max(0, 1 - since / 0.5);
  ctx.save();
  ctx.translate(Math.sin(t * 60) * 10 * shake, 0);
  // Emoji don't draw below 60 pixels, so a long hook gets more lines before it gets smaller letters.
  let size = 100;
  const lineCount = box.height > 600 ? 5 : 4;
  let lines = layoutWords(ctx, tokens, size, box.width - 40, paint.font);
  while (lines.length > lineCount && size > 60) lines = layoutWords(ctx, tokens, (size -= 6), box.width - 40, paint.font);
  const lineHeight = size * 1.12;
  let y = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  for (const line of lines) {
    let x = (WIDTH - line.width) / 2;
    for (const token of line.tokens) {
      const lit = token.index === current;
      const font = `900 ${size}px ${paint.font}`;
      if (lit && paint.style.hook !== "color") {
        const pad = size * 0.14;
        ctx.save();
        ctx.fillStyle = paint.color;
        if (paint.style.hook === "marker") {
          ctx.translate(x + token.width / 2, y - size * 0.32);
          ctx.rotate(-0.03);
          ctx.globalAlpha *= 0.9;
          ctx.fillRect(-token.width / 2 - pad, -size * 0.4, token.width + pad * 2, size * 0.8);
        } else {
          ctx.beginPath();
          ctx.roundRect(x - pad, y - size * 0.84, token.width + pad * 2, size * 1.06, size * 0.18);
          glowing(ctx, paint.glow, 30, () => ctx.fill());
        }
        ctx.restore();
        ctx.font = font;
        ctx.fillStyle = paint.ink;
        ctx.fillText(token.text, x, y);
      } else {
        outlined(ctx, token.text, x, y, font, lit ? paint.color : paint.text, size * 0.16, lit ? paint.glow : undefined);
      }
      x += token.width + size * 0.28;
    }
    y += lineHeight;
  }
  ctx.restore();
}

// The top of a split, edge to edge: the hook or the ending on a plain panel, the diff as a screen recording of an editor,
// the pull request as its page, or the visual itself. The stamp is in the theme's first color, `first`.
function drawTop(ctx: SKRSContext2D, card: Card, video: Canvas | undefined, timeline: Timeline, index: number, t: number, since: number, length: number, paint: Paint, first: Paint): void {
  const box = { x: 0, y: 0, width: WIDTH, height: SPLIT };
  if (isWords(card)) drawWordsPanel(ctx, box, paint);
  if (card.kind === "headline") drawHook(ctx, card, timeline, index, t, since, WORDS_BOX, paint);
  if (card.kind === "stamp") drawStamp(ctx, card, since, WORDS_BOX, first);
  if (card.kind === "code") drawCode(ctx, card, box, APP_BAR, since, length, paint);
  if (card.kind === "pull-request") drawPage(ctx, card.pr, box, APP_BAR, since, length, paint);
  if (card.kind === "media") drawMedia(ctx, card, video, box, since, length);
}

// A visual that fills the screen down to `bottom`, where a presenter keyed out in front of it starts: a picture or a clip
// filling it, a post shown whole, anything wide across the middle, or the diff or the pull request, on a plain dark
// background wherever the visual doesn't reach.
function drawScreen(ctx: SKRSContext2D, card: Card, video: Canvas | undefined, bottom: number, since: number, length: number, paint: Paint): void {
  if (isPanel(card)) {
    ctx.fillStyle = EDITOR.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Under the captions, the screen is left plain. With the whole screen, the code is bigger.
    const box = { x: 0, y: 0, width: WIDTH, height: Math.min(bottom, CAPTION_Y - 140) };
    const size = bottom === HEIGHT ? 36 : 32;
    if (card.kind === "code") drawCode(ctx, card, box, APP_BAR, since, length, paint, size);
    else drawPage(ctx, card.pr, box, APP_BAR, since, length, paint, size);
  }
  if (card.kind !== "media") return;
  const source = video ?? card.image;
  if (card.fit === "cover" && source && source.width > source.height * 0.8) drawWide(ctx, source, WIDE_ALONE, since);
  else drawMedia(ctx, card, video, card.fit === "contain" ? POST_ALONE : FULL, since, length);
}

// Behind the hook or the ending in the top of a split: a plain dark panel with a soft glow of the segment's color.
function drawWordsPanel(ctx: SKRSContext2D, box: Box, paint: Paint): void {
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  const [x, y] = [box.x + box.width / 2, box.y + box.height * 0.55];
  const glow = ctx.createRadialGradient(x, y, 0, x, y, box.width * 0.75);
  glow.addColorStop(0, `${paint.color}40`);
  glow.addColorStop(1, `${paint.color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(box.x, box.y, box.width, box.height);
}

// The diff the beat is about, the way a screen recording of an editor shows it: the file's tab, line numbers, and rows,
// with the rows the line is about selected one after another as it's said, a blinking cursor where the selection ends,
// and the view easing in on them. What matters starts `inset` pixels down the box, under whatever the apps draw over
// it. `size` is the code's font size, at the frame's full width.
function drawCode(ctx: SKRSContext2D, beat: Extract<Card, { kind: "code" }>, box: Box, inset: number, since: number, length: number, paint: Paint, size = 32): void {
  const { rows } = beat;
  const rowHeight = Math.round(size * 1.62);
  const tab = { y: box.y + inset, height: Math.round(size * 2.4) };
  const top = tab.y + tab.height + Math.round(size * 0.8);
  const count = Math.max(3, Math.floor((box.y + box.height - top - size * 0.6) / rowHeight));
  const first = firstRow(rows.length, beat.from, beat.to, count);
  const shown = rows.slice(first - 1, first - 1 + count);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.fillStyle = EDITOR.background;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  const [focusX, focusY] = [box.x + box.width * 0.35, top + ((beat.from + beat.to) / 2 - first + 0.5) * rowHeight];
  const zoom = 1 + 0.08 * easeInOut(clamp(since / Math.max(2, length), 0, 1));
  ctx.translate(focusX, focusY);
  ctx.scale(zoom, zoom);
  ctx.translate(-focusX, -focusY);

  ctx.fillStyle = EDITOR.bar;
  ctx.fillRect(box.x - box.width, tab.y, box.width * 3, tab.height);
  const name = beat.file.split("/").pop() ?? beat.file;
  ctx.font = `${Math.round(size * 0.85)}px ${SANS}`;
  const nameWidth = ctx.measureText(name).width;
  const baseline = tab.y + tab.height * 0.66;
  ctx.fillStyle = EDITOR.background;
  ctx.fillRect(box.x + size, tab.y + size * 0.45, nameWidth + size * 2.6, tab.height - size * 0.45);
  ctx.fillStyle = EDITOR.text;
  ctx.fillText(name, box.x + size * 1.8, baseline);
  ctx.fillStyle = paint.color;
  ctx.beginPath();
  ctx.arc(box.x + size * 2.4 + nameWidth, baseline - size * 0.28, size * 0.17, 0, Math.PI * 2);
  ctx.fill();
  const folder = beat.file.split("/").slice(0, -1).join(" › ");
  if (folder) {
    ctx.fillStyle = EDITOR.dim;
    ctx.fillText(fitText(ctx, folder, box.width - nameWidth - size * 6), box.x + nameWidth + size * 4.4, baseline);
  }

  // The selection sweeps over the rows the line is about while most of the line is said.
  const swept = clamp((since - 0.3) / Math.max(0.6, length * 0.6), 0, 1);
  const through = beat.from - 1 + Math.ceil(swept * (beat.to - beat.from + 1));
  const indent = commonIndent(shown);
  ctx.font = `${size}px ${MONO}`;
  const code = box.x + ctx.measureText("0000").width + size * 1.6;
  shown.forEach((row, index) => {
    const number = first + index;
    const y = top + index * rowHeight;
    const lit = number >= beat.from && number <= beat.to;
    const selected = lit && number <= through;
    if (row.kind === "add" || row.kind === "del") {
      ctx.fillStyle = row.kind === "add" ? EDITOR.added : EDITOR.removed;
      ctx.fillRect(box.x - box.width, y, box.width * 3, rowHeight);
    }
    if (selected) {
      ctx.fillStyle = `${paint.color}33`;
      ctx.fillRect(code - size * 0.3, y, box.width * 2, rowHeight);
      ctx.fillStyle = paint.color;
      ctx.fillRect(box.x, y, 6, rowHeight);
    }
    ctx.globalAlpha = lit ? 1 : 0.45;
    const line = y + rowHeight * 0.68;
    ctx.fillStyle = EDITOR.dim;
    ctx.textAlign = "right";
    ctx.fillText(String(row.newLine ?? row.oldLine ?? ""), code - size * 1.1, line);
    ctx.textAlign = "left";
    ctx.fillStyle = row.kind === "add" ? EDITOR.plus : EDITOR.minus;
    ctx.fillText({ add: "+", del: "−", same: "", hunk: "" }[row.kind], code - size * 0.85, line);
    ctx.fillStyle = row.kind === "hunk" ? EDITOR.hunk : EDITOR.text;
    const text = row.kind === "hunk" ? row.text : [...expandTabs(row.text)].slice(indent).join("");
    ctx.fillText(text, code, line);
    if (selected && number === through && Math.floor(since * 2.2) % 2 === 0) {
      ctx.fillStyle = paint.color;
      ctx.fillRect(Math.min(code + ctx.measureText(text).width + 4, box.x + box.width - 12), y + rowHeight * 0.16, Math.max(3, size * 0.1), rowHeight * 0.68);
    }
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

// The pull request the way its page on GitHub looks in the dark theme: the repository, the title, who wants to merge it
// and how big it is, then its description, which scrolls by slowly if it's long, with the view easing in. What matters
// starts `inset` pixels down the box, under whatever the apps draw over it.
function drawPage(ctx: SKRSContext2D, pr: PullRequest, box: Box, inset: number, since: number, length: number, paint: Paint, size = 32): void {
  const left = box.x + size * 1.75;
  const width = box.width - size * 3.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.fillStyle = EDITOR.background;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  const zoom = 1 + 0.05 * easeInOut(clamp(since / Math.max(2, length), 0, 1));
  const [focusX, focusY] = [box.x + box.width / 2, box.y + inset + size * 6];
  ctx.translate(focusX, focusY);
  ctx.scale(zoom, zoom);
  ctx.translate(-focusX, -focusY);

  let y = box.y + inset + size * 1.6;
  ctx.font = `500 ${Math.round(size * 0.9)}px ${SANS}`;
  ctx.fillStyle = EDITOR.dim;
  ctx.fillText(fitText(ctx, `${pr.repo}  ·  #${pr.number}`, width), left, y);
  y += size * 2.3;
  ctx.font = `700 ${Math.round(size * 1.6)}px ${SANS}`;
  ctx.fillStyle = EDITOR.text;
  for (const line of wrap(ctx, pr.title.replaceAll("`", ""), width, 3)) {
    ctx.fillText(line, left, y);
    y += size * 2;
  }
  y += size * 0.5;
  ctx.fillStyle = paint.color;
  ctx.beginPath();
  ctx.arc(left + size * 0.6, y - size * 0.32, size * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 ${Math.round(size * 0.7)}px ${SANS}`;
  ctx.fillStyle = paint.ink;
  ctx.textAlign = "center";
  ctx.fillText(pr.author.charAt(0).toUpperCase(), left + size * 0.6, y - size * 0.08);
  ctx.textAlign = "left";
  ctx.font = `${Math.round(size * 0.9)}px ${SANS}`;
  ctx.fillStyle = EDITOR.dim;
  const commits = pr.commits.length || 1;
  ctx.fillText(fitText(ctx, `${pr.author} wants to merge ${commits} commit${commits === 1 ? "" : "s"} into ${pr.base} from ${pr.head}`, width - size * 1.8), left + size * 1.6, y);
  y += size * 1.9;
  let x = left;
  const meta = (text: string, color: string) => {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;
  };
  meta(`+${pr.additions} `, EDITOR.plus);
  meta(`−${pr.deletions}`, EDITOR.minus);
  meta(`  ·  ${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"} changed`, EDITOR.dim);
  y += size * 1.3;
  ctx.fillStyle = EDITOR.line;
  ctx.fillRect(box.x, y, box.width, 2);
  y += size * 2;

  ctx.font = `${size}px ${SANS}`;
  const lineHeight = size * 1.45;
  const lines = wrap(ctx, plainText(pr.description) || pr.commits.join(". "), width, 60);
  const room = box.y + box.height - y - size * 0.5;
  const overflow = Math.max(0, lines.length * lineHeight - room);
  const p = clamp((since - 1) / Math.max(1, length - 2), 0, 1);
  ctx.beginPath();
  ctx.rect(box.x, y - size, box.width, room + size);
  ctx.clip();
  ctx.fillStyle = EDITOR.prose;
  lines.forEach((line, index) => ctx.fillText(line, left, y + index * lineHeight - overflow * (p * p * (3 - 2 * p))));
  ctx.restore();
}

// A picture, screenshot, or frame of video in `box`. It fills the box and drifts slowly closer, a screenshot taller than
// the box scrolls down it after a moment, and a post is shown whole. Something that couldn't be fetched leaves the
// beat's emoji, big.
function drawMedia(ctx: SKRSContext2D, card: Extract<Card, { kind: "media" }>, video: Canvas | undefined, box: Box, since: number, length: number): void {
  const source = video ?? card.image;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  if (!source) {
    ctx.font = `240px ${EMOJI}`;
    ctx.textAlign = "center";
    ctx.fillText(card.emoji, box.x + box.width / 2, box.y + box.height / 2 + 90);
    ctx.textAlign = "left";
  } else if (card.fit === "contain") {
    const scale = Math.min(box.width / source.width, box.height / source.height) * (1 + Math.min(since, 8) * 0.004);
    const [width, height] = [source.width * scale, source.height * scale];
    ctx.drawImage(source, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
  } else if (card.fit === "scroll" && source.height / source.width > box.height / box.width) {
    const height = (source.height * box.width) / source.width;
    const travel = Math.min(height - box.height, box.height * 1.2);
    const p = clamp((since - 0.6) / Math.max(1, length - 1.2), 0, 1);
    ctx.drawImage(source, box.x, box.y - travel * (p * p * (3 - 2 * p)), box.width, height);
  } else {
    const scale = Math.max(box.width / source.width, box.height / source.height) * (1 + Math.min(since, 8) * 0.012);
    const [width, height] = [source.width * scale, source.height * scale];
    ctx.drawImage(source, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
  }
  ctx.restore();
}

// A visual laid over the presenter's video, the way a creator drops a screenshot onto what they filmed: in its spot at its
// own shape, or filling the spot if it's a page that scrolls or a picture that's cropped, with rounded corners and a
// shadow, coming in the theme's way and creeping closer. The diff or the pull request goes over as a window, drawn at full
// width on `panel` first and scaled down into its spot.
function drawOverlay(ctx: SKRSContext2D, card: Card, video: Canvas | undefined, panel: Canvas, { box: spot }: Placement, since: number, length: number, paint: Paint): void {
  const media = card.kind === "media" ? card : undefined;
  if (card.kind === "code") drawCode(panel.getContext("2d"), card, { x: 0, y: 0, width: WIDTH, height: PANEL_HEIGHT }, 0, since, length, paint, 36);
  else if (card.kind === "pull-request") drawPage(panel.getContext("2d"), card.pr, { x: 0, y: 0, width: WIDTH, height: PANEL_HEIGHT }, 0, since, length, paint, 36);
  else if (!media) return;
  const source = media ? (video ?? media.image) : panel;
  const shaped = source && (!media || media.fit === "contain" || source.width > source.height * 1.2);
  const scale = shaped ? Math.min(spot.width / source.width, spot.height / source.height) : 1;
  const [width, height] = shaped ? [source.width * scale, source.height * scale] : [spot.width, spot.height];
  const box = { x: spot.x + (spot.width - width) / 2, y: spot.y + (spot.height - height) / 2, width, height };
  const [middleX, middleY] = [box.x + width / 2, box.y + height / 2];
  const zoom = 1 + Math.min(since, 6) * 0.006;
  ctx.save();
  enter(ctx, paint.style.motion, since, middleX, middleY);
  ctx.translate(middleX, middleY);
  ctx.scale(zoom, zoom);
  ctx.translate(-middleX, -middleY);
  ctx.shadowColor = "rgb(0 0 0 / 0.45)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  if (media && source && media.fit === "contain") ctx.drawImage(source, box.x, box.y, width, height);
  else {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, width, height, 28);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.clip();
    if (media) drawMedia(ctx, media, video, box, since, length);
    else ctx.drawImage(panel, box.x, box.y, width, height);
  }
  ctx.restore();
}

// Something that isn't tall, like a landscape or square clip, shown whole across `box`, on the plain dark background.
function drawWide(ctx: SKRSContext2D, source: Image | Canvas, box: Box, since: number): void {
  const scale = Math.min(box.width / source.width, box.height / source.height) * (1 + Math.min(since, 8) * 0.006);
  const [width, height] = [source.width * scale, source.height * scale];
  ctx.drawImage(source, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
}

// The last segment's few words, stamped on with a bounce in `box`. Words that don't fit on one line at a good size go on
// two, since emoji don't draw below 60 pixels.
function drawStamp(ctx: SKRSContext2D, card: Extract<Card, { kind: "stamp" }>, since: number, box: Box, paint: Paint): void {
  const p = Math.min(1, since / 0.3);
  const scale = 1 + 0.6 * (1 - easeOutBack(p));
  const words = `${card.text.toUpperCase()} ${card.emoji}`.split(/\s+/).filter(Boolean);
  const room = box.width - 140;
  let size = 120;
  let lines = [words.join(" ")];
  const widest = () => Math.max(...lines.map((line) => ctx.measureText(line).width));
  const shrink = (smallest: number) => {
    ctx.font = `900 ${(size = 120)}px ${paint.font}`;
    while (widest() > room && size > smallest) ctx.font = `900 ${(size -= 6)}px ${paint.font}`;
  };
  shrink(84);
  if (widest() > room && words.length > 1) {
    lines = twoLines(ctx, words);
    shrink(60);
  }
  const width = widest() + 120;
  const lineHeight = size * 1.1;
  const height = size * 0.6 + lineHeight * lines.length;
  const centerY = box.y + box.height / 2 - 30;
  const style = paint.style.stamp;
  ctx.save();
  ctx.translate(WIDTH / 2, centerY);
  if (style === "banner") {
    // A band across the whole screen, sliding in from the left like a news ticker.
    ctx.translate(-(1 - easeOut(Math.min(1, since / 0.35))) * WIDTH, 0);
    ctx.rotate(-0.03);
    ctx.fillStyle = paint.color;
    glowing(ctx, paint.glow, 40, () => ctx.fillRect(-WIDTH / 2 - 60, -height / 2, WIDTH + 120, height));
  } else {
    if (style === "stamp") ctx.rotate(-0.06);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, p * 3);
    if (style === "stamp") {
      ctx.fillStyle = paint.color;
      ctx.beginPath();
      ctx.roundRect(-width / 2, -height / 2, width, height, 28);
      glowing(ctx, paint.glow, 40, () => ctx.fill());
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#111";
      ctx.stroke();
    }
    if (style === "badge") {
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(-width / 2 + 14, -height / 2 + 14, width, height, height / 2);
      ctx.fill();
      ctx.fillStyle = paint.color;
      ctx.beginPath();
      ctx.roundRect(-width / 2, -height / 2, width, height, height / 2);
      glowing(ctx, paint.glow, 40, () => ctx.fill());
    }
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => {
    const y = 6 + (index - (lines.length - 1) / 2) * lineHeight;
    if (style === "outline") outlined(ctx, line, 0, y, ctx.font, paint.color, size * 0.16, paint.glow);
    else {
      ctx.fillStyle = paint.ink;
      ctx.fillText(line, 0, y);
    }
  });
  ctx.restore();
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 36px ${SANS}`;
  ctx.fillStyle = "rgb(255 255 255 / 0.8)";
  ctx.textAlign = "center";
  ctx.fillText(fitText(ctx, card.note, box.width), WIDTH / 2, centerY + height / 2 + 70);
  ctx.textAlign = "left";
}

// Up to three words of what's being said, in big outlined letters, with the word being said picked out the theme's way:
// bigger and in the segment's color, in a box of the color, with a bar of it underneath, or, like karaoke, every word of
// the caption showing from the start and turning the color as it's said. Each word pops in when it's said, except in
// karaoke, and every word has a slot wide enough for it at its biggest, so nothing moves as words come in. One theme
// shows just the word being said, big, on its own.
function drawCaption(ctx: SKRSContext2D, captions: Caption[], part: number, t: number, paint: Paint, y: number): void {
  const caption = captions.findLast((each) => each.part === part && each.words[0].start <= t);
  if (!caption) return;
  const current = caption.words.findLastIndex((word) => word.start <= t);
  const texts = caption.words.map((word) => display(word.text));
  const style = paint.style.caption;
  if (style === "single") return drawWord(ctx, texts[current], t - caption.words[current].start, paint, y);
  let size = 92;
  while (captionWidth(ctx, texts, size, paint.font) > CAPTION_WIDTH && size > 50) size -= 6;
  let x = (WIDTH - captionWidth(ctx, texts, size, paint.font)) / 2;
  const widths = texts.map((text) => ctx.measureText(text).width * CURRENT_SCALE);
  texts.forEach((text, index) => {
    const since = t - caption.words[index].start;
    const said = since >= 0;
    if (said || style === "karaoke") {
      const lit = index === current;
      const appear = style === "karaoke" ? 1 : 0.6 + 0.4 * easeOutBack(Math.min(1, since / 0.12));
      const scale = (style === "pop" && lit ? CURRENT_SCALE : 1) * appear;
      ctx.save();
      ctx.translate(x + widths[index] / 2, y);
      ctx.scale(scale, scale);
      const width = ctx.measureText(text).width;
      const stroke = size * 0.17;
      if (style === "box" && lit) {
        const pad = size * 0.16;
        ctx.fillStyle = paint.color;
        ctx.beginPath();
        ctx.roundRect(-width / 2 - pad, -size * 0.84, width + pad * 2, size * 1.06, size * 0.2);
        glowing(ctx, paint.glow, 30, () => ctx.fill());
        ctx.fillStyle = paint.ink;
        ctx.fillText(text, -width / 2, 0);
      } else if (style === "karaoke") {
        outlined(ctx, text, -width / 2, 0, ctx.font, said ? paint.color : paint.text, stroke, said ? paint.glow : undefined);
      } else {
        outlined(ctx, text, -width / 2, 0, ctx.font, style === "pop" && lit ? paint.color : paint.text, stroke, style === "pop" && lit ? paint.glow : undefined);
        if (style === "underline" && lit) {
          ctx.fillStyle = paint.color;
          glowing(ctx, paint.glow, 24, () => ctx.fillRect(-width / 2, size * 0.16, width, size * 0.13));
        }
      }
      ctx.restore();
    }
    x += widths[index] + size * 0.3;
  });
}

// The word being said, alone, as big as fits, in the segment's color, popping in as it's said.
function drawWord(ctx: SKRSContext2D, text: string | undefined, since: number, paint: Paint, y: number): void {
  if (!text) return;
  let size = 132;
  ctx.font = `900 ${size}px ${paint.font}`;
  while (ctx.measureText(text).width > CAPTION_WIDTH && size > 60) ctx.font = `900 ${(size -= 6)}px ${paint.font}`;
  const scale = 0.7 + 0.3 * easeOutBack(Math.min(1, since / 0.12));
  ctx.save();
  ctx.translate(WIDTH / 2, y);
  ctx.scale(scale, scale);
  const width = ctx.measureText(text).width;
  outlined(ctx, text, -width / 2, 0, ctx.font, paint.color, size * 0.17, paint.glow);
  ctx.restore();
}

// How wide a caption's words are at `size`: each in a slot wide enough for it as the word being said, with the gaps
// between them.
function captionWidth(ctx: SKRSContext2D, texts: string[], size: number, font: string): number {
  ctx.font = `900 ${size}px ${font}`;
  return texts.reduce((sum, text) => sum + ctx.measureText(text).width * CURRENT_SCALE, 0) + size * 0.3 * (texts.length - 1);
}

// Groups the words of every part but the hook into captions of a few words, ending a caption at the end of a sentence or
// a clause, where a clip's words start or stop, or before a word that won't `fit` on its line.
function toCaptions(timeline: Timeline, fits: (texts: string[]) => boolean): Caption[] {
  const captions: Caption[] = [];
  for (const word of timeline.words) {
    if (timeline.parts[word.part].kind === "hook") continue;
    const last = captions.at(-1);
    const ended =
      last &&
      (last.words.length >= CAPTION_WORDS ||
        /[.!?,;:]["')]*$/.test(last.words.at(-1)!.text) ||
        Boolean(last.words[0].clip) !== Boolean(word.clip) ||
        !fits([...last.words, word].map((each) => display(each.text))));
    if (!last || last.part !== word.part || ended) captions.push({ words: [word], part: word.part });
    else last.words.push(word);
  }
  return captions;
}

// The first of `count` rows in view: the highlighted rows centered, or the first of them if there are more than fit.
function firstRow(total: number, from: number, to: number, count: number): number {
  const span = to - from + 1;
  const centered = span >= count ? from : from - Math.floor((count - span) / 2);
  return Math.max(1, Math.min(centered, total - count + 1));
}

// How many leading spaces every row on the card shares. Taking them off leaves more room on a narrow screen.
function commonIndent(rows: Row[]): number {
  const indents = rows.filter((row) => row.kind !== "hunk" && row.text.trim()).map((row) => expandTabs(row.text).search(/\S/));
  return indents.length ? Math.min(...indents) : 0;
}

function expandTabs(text: string): string {
  return text.replaceAll("\t", "    ").replace(/\r$/, "");
}

// Captions are in capitals, without the commas and periods between words.
function display(word: string): string {
  return word.toUpperCase().replace(/[.,;]+$/, "");
}

// The text of a pull request's description, without its Markdown or its section headings.
function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->|```[\s\S]*?```|!\[[^\]]*\]\([^)]*\)|^\s*#.*$/gm, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*([-*]\s+\[[ x]\]|>)\s*/gim, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Breaks text into lines that fit maxWidth, ending the last line with an ellipsis if there's more.
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    const line = lines.at(-1);
    if (line !== undefined && ctx.measureText(`${line} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${line} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), fitText(ctx, `${lines[maxLines - 1]}…`, maxWidth)];
}

// Splits words into two lines as even in width as they can be.
function twoLines(ctx: SKRSContext2D, words: string[]): string[] {
  let best = [words.join(" ")];
  let widest = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split++) {
    const lines = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (width < widest) [best, widest] = [lines, width];
  }
  return best;
}

function layoutWords(ctx: SKRSContext2D, tokens: string[], size: number, maxWidth: number, font: string) {
  ctx.font = `900 ${size}px ${font}`;
  const gap = size * 0.28;
  const lines: Array<{ tokens: Array<{ text: string; width: number; index: number }>; width: number }> = [];
  tokens.forEach((text, index) => {
    const width = ctx.measureText(text).width;
    const line = lines.at(-1);
    if (line && line.width + gap + width <= maxWidth) {
      line.tokens.push({ text, width, index });
      line.width += gap + width;
    } else {
      lines.push({ tokens: [{ text, width, index }], width });
    }
  });
  return lines;
}

// Text in `color` with a black outline, glowing in `glow`, if it's given.
function outlined(ctx: SKRSContext2D, text: string, x: number, y: number, font: string, color: string, stroke: number, glow?: string): void {
  ctx.font = font;
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke;
  ctx.strokeStyle = "#000";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  glowing(ctx, glow, stroke * 2, () => ctx.fillText(text, x, y));
}

// Draws with a soft glow of `color` around it, or plainly without one.
function glowing(ctx: SKRSContext2D, color: string | undefined, blur: number, draw: () => void): void {
  if (!color) return draw();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) shown = `${shown.slice(0, -2).trimEnd()}…`;
  return shown;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeOut(p: number): number {
  return 1 - (1 - p) ** 3;
}

function easeInOut(p: number): number {
  return p * p * (3 - 2 * p);
}

function easeOutBack(p: number): number {
  return 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
}
