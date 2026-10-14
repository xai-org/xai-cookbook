import { type Canvas, GlobalFonts, type Image, ImageData, type SKRSContext2D, createCanvas } from "@napi-rs/canvas";
import { FONT_FILES } from "./brand.ts";
import type { PullRequest, Row } from "./github.ts";
import type { Layout, Mood, OnScreen, Segment } from "./script.ts";
import type { Style, Theme } from "./themes.ts";

for (const { file } of FONT_FILES) GlobalFonts.registerFromPath(file);

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
// The size Grok Imagine renders the takes at.
export const TAKE_WIDTH = 720;
export const TAKE_HEIGHT = 1280;

// When everything in the video happens, in seconds from its start: each segment, in order, with how it's framed, and
// each word of the script, with the time it's said and the segment it's in.
export type Timeline = {
  duration: number;
  parts: Array<{ kind: Segment["kind"]; start: number; end: number; mood: Mood; layout: Layout }>;
  words: Array<{ text: string; start: number; part: number }>;
};
// What's drawn for each segment, in the same order as the timeline's parts: the hook in huge letters with a title under
// it, the pull request, rows of a file's diff, a picture, screenshot, or video credited to its `source`, or a stamp with
// a note under it. A media card's video comes in frame by frame. A screenshot taller than its space scrolls, and a post
// is shown whole.
export type Card =
  | { kind: "headline"; emoji: string; title: string }
  | { kind: "pull-request"; emoji: string; pr: PullRequest }
  | { kind: "code"; label: string; emoji: string; file: string; rows: Row[]; from: number; to: number }
  | { kind: "media"; label: string; emoji: string; source: string; fit: "cover" | "contain" | "scroll"; image?: Image }
  | { kind: "stamp"; text: string; emoji: string; note: string };
type Box = { x: number; y: number; width: number; height: number };
// How a segment's words and stickers look: its color from the theme, the color of words on that color, the font for big
// words, the color of caption words that aren't being said, and the color to glow in, if they glow.
type Paint = { color: string; ink: string; font: string; text: string; glow?: string; style: Style; labels: boolean };

// Canvas uses the first font in a list that's installed, and takes any character that font lacks from the fonts after
// it, which is how the emoji get drawn. Generic names like monospace don't reliably pick the right kind of font, so each
// list names the usual fonts on macOS, Windows, and Linux.
const EMOJI = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK JP"`;
const SANS = `"Helvetica Neue", "Segoe UI", "DejaVu Sans", Arial, ${EMOJI}`;
const MONO = `Menlo, Consolas, "DejaVu Sans Mono", ${EMOJI}`;
// In a split, the top of the frame shows the card over a blurred, darkened copy of the take, and the bottom shows the
// presenter, so the card never covers their face.
const SPLIT = 880;
// The presenter's face sits this far down the bottom of the frame in every cut, whoever the presenter is, low enough that
// their head stays under the captions even when they lean into the camera.
const FACE_AT = 0.62;
const CARD = { x: 50, y: 130, width: WIDTH - 100, height: 710 };
const FULL = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
// With the presenter filling the screen, words go above their head, where every portrait leaves room.
const TOP = { x: 50, y: 130, width: WIDTH - 100, height: 470 };
// Laid over the presenter's video, a visual goes above their head, covering their hair at most, and under the apps' top
// bar.
const OVER = { x: 60, y: 168, width: WIDTH - 120, height: 500 };
// A post is shown whole, with room around it, and so is anything wide, like a landscape clip, across the screen.
const POST_ALONE = { x: 60, y: 220, width: WIDTH - 120, height: 1250 };
const WIDE_ALONE = { x: 0, y: 560, width: WIDTH, height: 800 };
// The presenter in a circle, in the bottom right corner above the captions.
const BUBBLE = { x: WIDTH - 250, y: 1400, radius: 190 };
const CODE_ROWS = 9;
const ROW_HEIGHT = 58;
const CODE_FONT = `34px ${MONO}`;
// Captions stay out from under what the apps draw over a short: above the bottom fifth of the frame, where YouTube
// Shorts, TikTok, and Reels put their own caption and title, and in the middle, clear of their buttons on the right.
const CAPTION_Y = 1460;
const CAPTION_WIDTH = WIDTH - 340;
// With the presenter in the bottom of the frame, in a split or in front of a green screen, the captions' tops go just
// under the card, clear of the presenter's head even as they lean in, since down at CAPTION_Y they'd cover their face.
const SEAM_TOP = CARD.y + CARD.height + 18;
const CAPTION_WORDS = 3;
const CURRENT_SCALE = 1.12;

type Caption = { words: Timeline["words"]; part: number };

// What a brand kit puts on a video: its logo in the top right corner of every frame, with `watermark`, and an end card
// after the last line, with its logo, name, and call to action.
export type Marks = { logo?: Image; watermark: boolean; endCard?: { name: string; line: string } };

// Returns a function that draws one frame of the finished video from the same frame of the cut, and returns its pixels,
// which ffmpeg reads as raw video. `tag` goes in the pill at the top, `cards` has a card for each part of the timeline,
// `face` is where the presenter's face is in their portrait, as a share of its width and height, and `theme` colors the
// words and stickers. `onScreen` says whether the title, in the pill and under the hook, and the stickers' labels are
// drawn at all. `video` is the frame of a media card's video for this frame of the cut, if it has one. In a green screen
// segment, the take arrives with the green already keyed out. `marks` are the brand kit's, if any.
export function frameDrawer(tag: string, cards: Card[], timeline: Timeline, face: { x: number; y: number }, theme: Theme, onScreen: OnScreen, marks?: Marks): (frame: number, take: Uint8Array, video?: Canvas) => Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const take = createCanvas(TAKE_WIDTH, TAKE_HEIGHT);
  // Shrinking the take to a few pixels and stretching it back is a much faster blur than a blur filter.
  const tiny = createCanvas(27, 48);
  const captions = toCaptions(timeline);
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
    const paint = paintOf(theme, index, onScreen.labels);
    const since = t - part.start;
    const length = part.end - part.start;
    take.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), TAKE_WIDTH, TAKE_HEIGHT), 0, 0);
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const presenter = () => drawPresenter(ctx, take, face, index, part.mood, since, length, t, part.layout === "split");

    const words = card.kind === "headline" || card.kind === "stamp";
    if (part.layout === "split") {
      drawBackdrop(ctx, take, tiny, SPLIT);
      presenter();
      if (card.kind === "headline") drawHook(ctx, card, timeline, index, t, since, CARD, paint, onScreen.title);
      if (card.kind === "pull-request") drawWhy(ctx, card.pr, card.emoji, since, paint);
      if (card.kind === "code") onCard(ctx, since, paint.style.motion, () => drawRows(ctx, card, paint));
      if (card.kind === "media") onCard(ctx, since, paint.style.motion, () => drawMedia(ctx, card, video, CARD, since, length, paint));
      if (card.kind === "stamp") drawStamp(ctx, card, since, CARD, paintOf(theme, 0));
    } else if (part.layout === "overlay" && card.kind === "media") {
      drawFull(ctx, take, face, index, part.mood, since, length, t);
      shade(ctx, 0, 260);
      drawOverlay(ctx, card, video, since, length, paint);
    } else if (part.layout === "full" || part.layout === "overlay" || words) {
      drawFull(ctx, take, face, index, part.mood, since, length, t);
      shade(ctx, 0, TOP.y + TOP.height + 120);
      if (card.kind === "headline") drawHook(ctx, card, timeline, index, t, since, TOP, paint, onScreen.title);
      else if (card.kind === "stamp") drawStamp(ctx, card, since, TOP, paintOf(theme, 0));
      else sticker(ctx, labelOf(card), card.emoji, 50, 130, paint, since);
    } else {
      // The visual fills the screen, with the presenter in a bubble, keyed out in front of it, covering the bottom of it,
      // or not at all. Keyed out, the presenter leaves no room to blur behind the visual, so it's a blurred copy of the
      // visual itself.
      const green = part.layout === "green";
      const source = card.kind === "media" ? (video ?? card.image) : undefined;
      const wide = card.kind === "media" && card.fit === "cover" && source && source.width > source.height * 1.2;
      if (!green) drawBackdrop(ctx, take, tiny, HEIGHT);
      else if (source && !wide) drawBlurred(ctx, source, tiny);
      if (card.kind === "media") {
        if (wide) drawWide(ctx, source, WIDE_ALONE, tiny, since);
        else drawMedia(ctx, card, video, card.fit === "contain" ? POST_ALONE : FULL, since, length);
        shade(ctx, 0, 420);
        sticker(ctx, card.label.toUpperCase(), card.emoji, 50, 130, paint, since);
        if (card.source) pill(ctx, card.source, 50, 220, `600 30px ${SANS}`, "rgb(0 0 0 / 0.55)", "#fff");
      } else {
        ctx.save();
        // The card goes in the middle of the screen.
        ctx.translate(0, (HEIGHT - CARD.height) / 2 - CARD.y);
        if (card.kind === "pull-request") drawWhy(ctx, card.pr, card.emoji, since, paint);
        if (card.kind === "code") onCard(ctx, since, paint.style.motion, () => drawRows(ctx, card, paint));
        ctx.restore();
      }
      if (part.layout === "bubble") drawBubble(ctx, take, face, since, paint.color);
      if (green) presenter();
    }

    drawProgress(ctx, timeline, t, theme);
    if (onScreen.title) pill(ctx, fitTo(ctx, tag, `600 30px ${SANS}`, WIDTH - 144 - (logo ? LOGO.width + 30 : 0)), 50, 60, `600 30px ${SANS}`, "rgb(0 0 0 / 0.45)", "#fff");
    if (logo) ctx.drawImage(logo, WIDTH - 50 - logo.width + LOGO.shadow, LOGO.top + (LOGO.height - logo.height) / 2);
    if (part.kind !== "hook") drawCaption(ctx, captions, index, t, paint, captionY(part.layout, paint.style.caption));
    return canvas.data();
  };
}

// The biggest a logo is drawn in the corner, level with the tag at the top of the frame, and the room around it for its
// shadow.
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
function paintOf(theme: Theme, part: number, labels = true): Paint {
  const color = theme.colors[part % theme.colors.length];
  return { color, ink: inkOn(color), font: `${theme.font}, ${EMOJI}`, text: theme.text, glow: theme.glow ? color : undefined, style: theme.style, labels };
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

// Near black or white, whichever stands out more on `color`, a hex color, by the contrast ratio of the web's
// accessibility guidelines.
function inkOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05;
  return luminance / 0.0556 >= 1.05 / luminance ? "#111" : "#fff";
}

// What's at a point of a frame, as a share of its width and height, in a segment of `kind` framed by `layout`, for a note
// about it: the captions, the sticker, the presenter, or what the segment shows, named in `shows`. `onScreen` says
// whether the title and the stickers were drawn.
export function spotAt(kind: Segment["kind"], layout: Layout, shows: string, x: number, y: number, onScreen: OnScreen): string {
  const [left, top] = [x * WIDTH, y * HEIGHT];
  const words = kind === "hook" || kind === "ending";
  const sticker = (atX: number, atY: number) => onScreen.labels && !words && left >= atX && left <= atX + 640 && top >= atY && top <= atY + 66;
  if (top < (onScreen.title ? 120 : 50)) return onScreen.title ? "the title and progress bar at the top" : "the progress bar at the top";
  const seam = layout === "split" || layout === "green";
  if (kind !== "hook" && (seam ? top > SEAM_TOP && top < SEAM_TOP + 140 : top > CAPTION_Y - 110 && top < CAPTION_Y + 50)) return "the captions";
  if (layout === "split") return top >= SPLIT ? "the presenter" : sticker(CARD.x + 34, CARD.y + 32) ? "the sticker" : shows;
  if (layout === "overlay" && !words) return top >= OVER.y && top <= OVER.y + OVER.height ? shows : "the presenter";
  if (layout === "full" || words) return top > TOP.y + TOP.height ? "the presenter" : words ? shows : sticker(50, 130) ? "the sticker" : "the presenter";
  if (sticker(50, 130)) return "the sticker";
  if (layout === "bubble" && Math.hypot(left - BUBBLE.x, top - BUBBLE.y) <= BUBBLE.radius) return "the presenter, in the bubble";
  if (layout === "green" && top >= SPLIT) return `the presenter, in front of ${shows}`;
  return shows;
}

// Where the captions' baseline goes. Under the card, it's as far below SEAM_TOP as the caption's letters are tall at
// their biggest, 132 pixels for one word on its own and 92 for a few.
function captionY(layout: Layout, style: Style["caption"]): number {
  if (layout !== "split" && layout !== "green") return CAPTION_Y;
  return SEAM_TOP + (style === "single" ? 132 : 92) * 0.84;
}

function labelOf(card: Card): string {
  return card.kind === "pull-request" ? "WHY IT MATTERS" : card.kind === "code" || card.kind === "media" ? card.label.toUpperCase() : "";
}

function drawBackdrop(ctx: SKRSContext2D, take: Canvas, tiny: Canvas, height: number): void {
  const small = tiny.getContext("2d");
  small.imageSmoothingQuality = "high";
  small.drawImage(take, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tiny, 0, 2, tiny.width, 22, -60, -60, WIDTH + 120, height + 120);
  ctx.fillStyle = "rgb(0 0 0 / 0.5)";
  ctx.fillRect(0, 0, WIDTH, height);
}

// A dark gradient down from the top of the frame, so words over a picture or the presenter stay readable.
function shade(ctx: SKRSContext2D, from: number, to: number): void {
  const gradient = ctx.createLinearGradient(0, from, 0, to);
  gradient.addColorStop(0, "rgb(0 0 0 / 0.6)");
  gradient.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, from, WIDTH, to - from);
}

// The presenter in the bottom of the frame, with the face kept in the same place. Each cut alternates between a wider
// and a closer shot, the way creators zoom on jump cuts, and creeps closer during the take. A shocked part lands with a
// quick punch in and a shake. In a split, a soft edge separates them from the card above. In front of a green screen,
// where the take has no background, the take moves down past its top edge when that's what keeps the face at FACE_AT.
function drawPresenter(ctx: SKRSContext2D, take: Canvas, face: { x: number; y: number }, index: number, mood: Mood, since: number, length: number, t: number, seam: boolean): void {
  const { zoom, shake } = motion(index, mood, since, length, 1.14);
  const height = HEIGHT - SPLIT;
  const scale = (WIDTH / TAKE_WIDTH) * zoom;
  const width = WIDTH / scale;
  const tall = height / scale;
  const x = clamp(face.x * TAKE_WIDTH - width / 2 + Math.sin(t * 90) * 8 * shake, 0, TAKE_WIDTH - width);
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

// The presenter filling the screen, with the same zooms as in the bottom of a split.
function drawFull(ctx: SKRSContext2D, take: Canvas, face: { x: number; y: number }, index: number, mood: Mood, since: number, length: number, t: number): void {
  const { zoom, shake } = motion(index, mood, since, length, 1.12);
  const scale = (HEIGHT / TAKE_HEIGHT) * zoom;
  const width = WIDTH / scale;
  const tall = HEIGHT / scale;
  const x = clamp(face.x * TAKE_WIDTH - width / 2 + Math.sin(t * 90) * 8 * shake, 0, TAKE_WIDTH - width);
  const y = clamp(face.y * TAKE_HEIGHT - 0.55 * tall + Math.cos(t * 70) * 6 * shake, 0, TAKE_HEIGHT - tall);
  ctx.drawImage(take, x, y, width, tall, 0, 0, WIDTH, HEIGHT);
}

function motion(index: number, mood: Mood, since: number, length: number, closer: number): { zoom: number; shake: number } {
  let zoom = (index % 2 ? closer : 1) + 0.05 * Math.min(1, since / Math.max(1, length));
  let shake = 0;
  if (mood === "shocked" && since < 0.4) {
    shake = 1 - since / 0.4;
    zoom += 0.22 * shake;
  }
  return { zoom, shake };
}

// The presenter's face in a circle in the corner, popping in as the segment starts, with a `ring` around it. The circle
// shows a wide square around where the face is in the portrait, since a presenter who leans during a take moves out of a
// tight one.
function drawBubble(ctx: SKRSContext2D, take: Canvas, face: { x: number; y: number }, since: number, ring: string): void {
  const radius = BUBBLE.radius * (0.6 + 0.4 * easeOutBack(Math.min(1, since / 0.3)));
  const size = TAKE_WIDTH * 0.85;
  const x = clamp(face.x * TAKE_WIDTH - size / 2, 0, TAKE_WIDTH - size);
  const y = clamp(face.y * TAKE_HEIGHT - size * 0.45, 0, TAKE_HEIGHT - size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(BUBBLE.x, BUBBLE.y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(take, x, y, size, size, BUBBLE.x - radius, BUBBLE.y - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(BUBBLE.x, BUBBLE.y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

// How far into the video it is, along the top, the theme's way: a bar for each part, filling as it plays in that part's
// color, like a story, one line, or a dot for each part, with the one playing stretched out and filling.
function drawProgress(ctx: SKRSContext2D, timeline: Timeline, t: number, theme: Theme): void {
  const playing = Math.max(0, timeline.parts.findLastIndex((part) => part.start <= t));
  if (theme.style.progress === "line") {
    ctx.fillStyle = "rgb(255 255 255 / 0.25)";
    ctx.beginPath();
    ctx.roundRect(50, 26, WIDTH - 100, 6, 3);
    ctx.fill();
    ctx.fillStyle = paintOf(theme, playing).color;
    ctx.beginPath();
    ctx.roundRect(50, 26, (WIDTH - 100) * clamp(t / timeline.duration, 0, 1), 6, 3);
    ctx.fill();
    return;
  }
  if (theme.style.progress === "dots") {
    const [dot, long, space] = [14, 48, 12];
    let x = (WIDTH - ((timeline.parts.length - 1) * (dot + space) + long)) / 2;
    timeline.parts.forEach((part, index) => {
      const width = index === playing ? long : dot;
      ctx.fillStyle = index < playing ? paintOf(theme, index).color : "rgb(255 255 255 / 0.3)";
      ctx.beginPath();
      ctx.roundRect(x, 22, width, dot, dot / 2);
      ctx.fill();
      if (index === playing) {
        ctx.fillStyle = paintOf(theme, index).color;
        ctx.beginPath();
        ctx.roundRect(x, 22, Math.max(dot, width * clamp((t - part.start) / (part.end - part.start), 0, 1)), dot, dot / 2);
        ctx.fill();
      }
      x += width + space;
    });
    return;
  }
  const gap = 10;
  const width = (WIDTH - 100 - gap * (timeline.parts.length - 1)) / timeline.parts.length;
  timeline.parts.forEach((part, index) => {
    const x = 50 + index * (width + gap);
    const filled = Math.min(1, Math.max(0, (t - part.start) / (part.end - part.start)));
    ctx.fillStyle = "rgb(255 255 255 / 0.3)";
    ctx.beginPath();
    ctx.roundRect(x, 24, width, 8, 4);
    ctx.fill();
    if (!filled) return;
    ctx.fillStyle = paintOf(theme, index).color;
    ctx.beginPath();
    ctx.roundRect(x, 24, width * filled, 8, 4);
    ctx.fill();
  });
}

// The hook in huge letters in `box`, each word lighting up as it's said the theme's way, in its color, over a highlighter
// stroke of it, or in a box of it, with a shake as it lands, and the video's title under it if `withTitle`.
function drawHook(ctx: SKRSContext2D, card: Extract<Card, { kind: "headline" }>, timeline: Timeline, part: number, t: number, since: number, box: Box, paint: Paint, withTitle: boolean): void {
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
  if (!withTitle) return;
  ctx.font = `500 34px ${SANS}`;
  ctx.fillStyle = "rgb(255 255 255 / 0.75)";
  ctx.textAlign = "center";
  ctx.fillText(fitText(ctx, card.title.replaceAll("`", ""), box.width), WIDTH / 2, box.y + box.height - 10);
  ctx.textAlign = "left";
}

// A card that comes in the theme's way when its part starts, sliding in from the side, popping up, or dropping in, then
// keeps creeping closer, so the picture never sits still.
function onCard(ctx: SKRSContext2D, since: number, motion: Style["motion"], draw: () => void): void {
  const p = Math.min(1, since / 0.3);
  const zoom = 1 + Math.min(since, 6) * 0.006;
  const [middleX, middleY] = [WIDTH / 2, CARD.y + CARD.height / 2];
  ctx.save();
  if (motion === "slide") ctx.translate((1 - easeOut(Math.min(1, since / 0.28))) * WIDTH, 0);
  if (motion === "drop") {
    ctx.translate(0, -(1 - easeOutBack(p)) * 300);
    ctx.translate(middleX, middleY);
    ctx.rotate((1 - p) * -0.06);
    ctx.translate(-middleX, -middleY);
  }
  const grow = motion === "pop" ? 0.8 + 0.2 * easeOutBack(p) : 1;
  if (motion === "pop") ctx.globalAlpha *= Math.min(1, p * 2.5);
  ctx.translate(middleX, middleY);
  ctx.scale(zoom * grow, zoom * grow);
  ctx.translate(-middleX, -middleY);
  ctx.fillStyle = "rgb(13 17 23 / 0.94)";
  ctx.beginPath();
  ctx.roundRect(CARD.x, CARD.y, CARD.width, CARD.height, 36);
  ctx.fill();
  ctx.strokeStyle = "rgb(255 255 255 / 0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();
  draw();
  ctx.restore();
}

// The pull request itself, for the why: its title, who opened it, how big it is, and how its description starts.
function drawWhy(ctx: SKRSContext2D, pr: PullRequest, emoji: string, since: number, paint: Paint): void {
  onCard(ctx, since, paint.style.motion, () => {
    sticker(ctx, "WHY IT MATTERS", emoji, CARD.x + 34, CARD.y + 32, paint);
    const left = CARD.x + 44;
    const width = CARD.width - 88;
    let y = CARD.y + 170;
    ctx.font = `700 50px ${SANS}`;
    ctx.fillStyle = "#fff";
    for (const line of wrap(ctx, pr.title.replaceAll("`", ""), width, 3)) {
      ctx.fillText(line, left, y);
      y += 62;
    }
    y += 6;
    let x = left;
    const meta = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    };
    ctx.font = `500 32px ${SANS}`;
    meta(`${pr.author} · `, "rgb(255 255 255 / 0.6)");
    meta(`+${pr.additions} `, "#3fb950");
    meta(`−${pr.deletions}`, "#f85149");
    meta(` · ${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}`, "rgb(255 255 255 / 0.6)");
    y += 66;
    ctx.font = `32px ${SANS}`;
    ctx.fillStyle = "rgb(255 255 255 / 0.75)";
    const about = plainText(pr.description) || pr.commits.join(". ");
    for (const line of wrap(ctx, about, width, Math.floor((CARD.y + CARD.height - 30 - y) / 46) + 1)) {
      ctx.fillText(line, left, y);
      y += 46;
    }
  });
}

// The rows of the diff the beat is about. The highlighted rows are in full color, marked in the beat's color, and the
// rest are dimmed.
function drawRows(ctx: SKRSContext2D, beat: Extract<Card, { kind: "code" }>, paint: Paint): void {
  const { rows } = beat;
  sticker(ctx, beat.label.toUpperCase(), beat.emoji, CARD.x + 34, CARD.y + 32, paint);
  const lines = rows.slice(beat.from - 1, beat.to).map((row) => row.newLine ?? row.oldLine).filter((line) => line !== undefined);
  const where = lines.length ? `L${lines[0]}${lines.length > 1 ? `–${lines.at(-1)}` : ""}` : "";
  ctx.font = `28px ${MONO}`;
  ctx.fillStyle = "rgb(255 255 255 / 0.55)";
  ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, [beat.file.split("/").pop(), where].filter(Boolean).join(" · "), 420), CARD.x + CARD.width - 34, CARD.y + 74);
  ctx.textAlign = "left";

  const first = firstRow(rows.length, beat.from, beat.to);
  const shown = rows.slice(first - 1, first - 1 + CODE_ROWS);
  const indent = commonIndent(shown);
  ctx.font = CODE_FONT;
  const maxChars = Math.floor((CARD.width - 90) / ctx.measureText("M").width);
  const top = CARD.y + 125 + ((CODE_ROWS - shown.length) * ROW_HEIGHT) / 2;
  shown.forEach((row, index) => {
    const number = first + index;
    const lit = number >= beat.from && number <= beat.to;
    const y = top + index * ROW_HEIGHT;
    if (row.kind === "add" || row.kind === "del") {
      ctx.fillStyle = `rgb(${row.kind === "add" ? "63 185 80" : "248 81 73"} / ${lit ? 0.36 : 0.13})`;
      ctx.fillRect(CARD.x, y, CARD.width, ROW_HEIGHT);
    } else if (lit) {
      ctx.fillStyle = "rgb(255 255 255 / 0.07)";
      ctx.fillRect(CARD.x, y, CARD.width, ROW_HEIGHT);
    }
    if (lit) {
      ctx.fillStyle = paint.color;
      ctx.fillRect(CARD.x, y, 9, ROW_HEIGHT);
    }
    ctx.globalAlpha = lit ? 1 : 0.38;
    ctx.fillStyle = row.kind === "add" ? "#3fb950" : "#f85149";
    ctx.fillText({ add: "+", del: "−", same: "", hunk: "" }[row.kind], CARD.x + 28, y + 41);
    ctx.fillStyle = row.kind === "hunk" ? "#79c0ff" : "#e6edf3";
    const text = row.kind === "hunk" ? "⋯" : [...expandTabs(row.text)].slice(indent).join("");
    ctx.fillText([...text].length > maxChars ? `${[...text].slice(0, maxChars - 1).join("")}…` : text, CARD.x + 64, y + 41);
    ctx.globalAlpha = 1;
  });
}

// A picture, screenshot, or frame of video in `box`. It fills the box and drifts slowly closer, a screenshot taller than
// the box scrolls down it after a moment, and a post is shown whole. Something that couldn't be fetched leaves the
// beat's emoji, big. On a card, painted with `framed`, the beat's sticker and where it came from go on top.
function drawMedia(ctx: SKRSContext2D, card: Extract<Card, { kind: "media" }>, video: Canvas | undefined, box: Box, since: number, length: number, framed?: Paint): void {
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
  if (!framed) return;
  sticker(ctx, card.label.toUpperCase(), card.emoji, box.x + 34, box.y + 32, framed);
  if (card.source) pill(ctx, card.source, box.x + 34, box.y + box.height - 80, `600 28px ${SANS}`, "rgb(0 0 0 / 0.6)", "#fff");
}

// A picture, screenshot, or frame of video laid over the presenter's video, the way a creator drops one onto what they
// filmed: in OVER at its own shape, or filling OVER if it's a page that scrolls or a picture that's cropped, with rounded
// corners and a shadow, coming in the theme's way and creeping closer. The beat's sticker goes on its corner.
function drawOverlay(ctx: SKRSContext2D, card: Extract<Card, { kind: "media" }>, video: Canvas | undefined, since: number, length: number, paint: Paint): void {
  const source = video ?? card.image;
  const shaped = source && (card.fit === "contain" || source.width > source.height * 1.2);
  const scale = shaped ? Math.min(OVER.width / source.width, OVER.height / source.height) : 1;
  const [width, height] = shaped ? [source.width * scale, source.height * scale] : [OVER.width, OVER.height];
  const box = { x: OVER.x + (OVER.width - width) / 2, y: OVER.y + (OVER.height - height) / 2, width, height };
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
  if (source && card.fit === "contain") ctx.drawImage(source, box.x, box.y, width, height);
  else {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, width, height, 28);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.clip();
    drawMedia(ctx, card, video, box, since, length);
  }
  ctx.restore();
  sticker(ctx, card.label.toUpperCase(), card.emoji, box.x - 12, box.y - 36, paint, since);
  if (card.source) pill(ctx, card.source, box.x + 24, box.y + height - 70, `600 28px ${SANS}`, "rgb(0 0 0 / 0.6)", "#fff");
}

// Something wide, like a landscape clip, shown whole across `box`, over a blurred copy of itself that fills the screen.
function drawWide(ctx: SKRSContext2D, source: Image | Canvas, box: Box, tiny: Canvas, since: number): void {
  drawBlurred(ctx, source, tiny);
  const scale = Math.min(box.width / source.width, box.height / source.height) * (1 + Math.min(since, 8) * 0.006);
  const [width, height] = [source.width * scale, source.height * scale];
  ctx.drawImage(source, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
}

// A blurred, darkened copy of `source` filling the screen.
function drawBlurred(ctx: SKRSContext2D, source: Image | Canvas, tiny: Canvas): void {
  const small = tiny.getContext("2d");
  const cover = Math.max(tiny.width / source.width, tiny.height / source.height);
  small.clearRect(0, 0, tiny.width, tiny.height);
  small.drawImage(source, (tiny.width - source.width * cover) / 2, (tiny.height - source.height * cover) / 2, source.width * cover, source.height * cover);
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, -60, -60, WIDTH + 120, HEIGHT + 120);
  ctx.fillStyle = "rgb(0 0 0 / 0.35)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
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
  const slots = () => {
    ctx.font = `900 ${size}px ${paint.font}`;
    return texts.map((text) => ctx.measureText(text).width * CURRENT_SCALE);
  };
  let widths = slots();
  const total = () => widths.reduce((sum, width) => sum + width, 0) + size * 0.3 * (texts.length - 1);
  while (total() > CAPTION_WIDTH && size > 50) {
    size -= 6;
    widths = slots();
  }
  let x = (WIDTH - total()) / 2;
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

// Groups the words of every part but the hook into captions of a few words, ending a caption at the end of a sentence or
// a clause.
function toCaptions(timeline: Timeline): Caption[] {
  const captions: Caption[] = [];
  for (const word of timeline.words) {
    if (timeline.parts[word.part].kind === "hook") continue;
    const last = captions.at(-1);
    const ended = last && (last.words.length >= CAPTION_WORDS || /[.!?,;:]["')]*$/.test(last.words.at(-1)!.text));
    if (!last || last.part !== word.part || ended) captions.push({ words: [word], part: word.part });
    else last.words.push(word);
  }
  return captions;
}

// The first row on the card: the highlighted rows centered, or the first of them if there are more than fit.
function firstRow(total: number, from: number, to: number): number {
  const span = to - from + 1;
  const centered = span >= CODE_ROWS ? from : from - Math.floor((CODE_ROWS - span) / 2);
  return Math.max(1, Math.min(centered, total - CODE_ROWS + 1));
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

// A beat's label on a sticker in the segment's color, in the theme's shape, with its emoji at the end: a rounded pill, a
// block with a hard shadow, a strip of tape with torn ends, an outline on dark glass, or the label alone with a bar under
// it. A sticker on its own moves in the theme's way as its segment starts, `since` seconds ago; one on a card moves with
// the card. The label is centered by its own height, since fonts sit at different heights on the same line. Apple's emoji
// font has no small sizes of some newer emoji, which then don't draw at all, so emoji are never drawn smaller than 60
// pixels.
function sticker(ctx: SKRSContext2D, label: string, emoji: string, x: number, y: number, paint: Paint, since = Number.POSITIVE_INFINITY): void {
  if (!paint.labels) return;
  ctx.save();
  enter(ctx, paint.style.motion, since, x, y + 33);
  ctx.font = `900 40px ${paint.font}`;
  const metrics = ctx.measureText(label);
  const width = metrics.width;
  const box = width + 120;
  const baseline = y + 33 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  const shape = paint.style.sticker;
  if (shape === "pill") {
    ctx.fillStyle = paint.color;
    ctx.beginPath();
    ctx.roundRect(x, y, box, 66, 33);
    glowing(ctx, paint.glow, 30, () => ctx.fill());
  }
  if (shape === "block") {
    ctx.fillStyle = "#000";
    ctx.fillRect(x + 9, y + 9, box, 66);
    ctx.fillStyle = paint.color;
    ctx.fillRect(x, y, box, 66);
  }
  if (shape === "tape") {
    ctx.translate(x + box / 2, y + 33);
    ctx.rotate(-0.035);
    ctx.translate(-(x + box / 2), -(y + 33));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + box, y);
    for (let step = 1; step <= 6; step++) ctx.lineTo(x + box + (step % 2 ? 8 : 0), y + 11 * step);
    ctx.lineTo(x, y + 66);
    for (let step = 5; step >= 0; step--) ctx.lineTo(x - (step % 2 ? 8 : 0), y + 11 * step);
    ctx.closePath();
    ctx.fillStyle = paint.color;
    ctx.globalAlpha *= 0.94;
    glowing(ctx, paint.glow, 30, () => ctx.fill());
    ctx.globalAlpha /= 0.94;
  }
  if (shape === "outline") {
    ctx.fillStyle = "rgb(0 0 0 / 0.55)";
    ctx.beginPath();
    ctx.roundRect(x, y, box, 66, 16);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = paint.color;
    glowing(ctx, paint.glow, 24, () => ctx.stroke());
  }
  if (shape === "underline") {
    outlined(ctx, label, x + 4, baseline, ctx.font, "#fff", 9);
    ctx.fillStyle = paint.color;
    glowing(ctx, paint.glow, 20, () => ctx.fillRect(x + 4, y + 62, width, 10));
  } else {
    ctx.fillStyle = shape === "outline" ? paint.color : paint.ink;
    glowing(ctx, shape === "outline" ? paint.glow : undefined, 16, () => ctx.fillText(label, x + 24, baseline));
  }
  ctx.font = `64px ${EMOJI}`;
  ctx.fillText(emoji, x + width + 40, y + 57);
  ctx.restore();
}

function pill(ctx: SKRSContext2D, text: string, x: number, y: number, font: string, background: string, color: string): void {
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 26;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(x, y, metrics.width + 44, height, height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 22, y + 13 + metrics.actualBoundingBoxAscent);
}

function fitTo(ctx: SKRSContext2D, text: string, font: string, maxWidth: number): string {
  ctx.font = font;
  return fitText(ctx, text, maxWidth);
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

function easeOutBack(p: number): number {
  return 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
}
