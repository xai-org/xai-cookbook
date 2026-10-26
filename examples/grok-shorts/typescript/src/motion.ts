import { createCanvas } from "@napi-rs/canvas";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { FONT_FILES } from "./brand.ts";
import { HEIGHT, OVER, SPLIT, WIDTH } from "./frames.ts";
import type { Layout, Motion } from "./script.ts";
import { type Graphic, type Theme, luminanceOf } from "./themes.ts";

// Motion graphics, for beats that are clearer drawn out than shown, like a diagram of how something works or numbers to
// compare. Each one is a small HyperFrames composition: HTML laid out here from the beat's graphic, with a GSAP timeline
// that brings each item on screen as the presenter says its cue word. HyperFrames renders it to a video in headless
// Chrome, and the video plays it like any clip. A video's graphics all take its theme's look, the way an editor styles a
// video's graphics alike, and each is presented a little differently from the one before it, so they don't repeat.

const run = promisify(execFile);
const find = createRequire(import.meta.url).resolve;
// HyperFrames' command line, run with this Node, and the scripts copied next to each composition so a render needs no
// network: GSAP, and Rough.js, which draws shapes as if by hand.
const HYPERFRAMES = join(dirname(find("hyperframes/package.json")), "bin/hyperframes.mjs");
const SCRIPTS = [find("gsap/dist/gsap.min.js"), find("roughjs/bundled/rough.js")];
const SANS = `"Helvetica Neue", "Segoe UI", "DejaVu Sans", Arial, sans-serif`;
// Measures words in the fonts the graphic is rendered in, which Chrome finds on this computer the same way.
const ruler = createCanvas(1, 1).getContext("2d");

type Box = { x: number; y: number; width: number; height: number };
type Frame = { width: number; height: number; top: number; bottom: number; title: number };
type Item = Motion["items"][number];
// A shape the page draws when it loads, the look's way: a box, or a ring in a box, by its corner and size, a line or an
// arrow between two points, or a bar or a column filled in.
type Shape = { id: string; kind: "box" | "ring" | "line" | "arrow" | "bar" | "column"; at: number[]; color: string };
// A graphic's words, laid out as HTML, the shapes drawn around and between them, and the GSAP calls that bring them on,
// which read each item's time from T.
type Drawn = { html: string; shapes: Shape[]; script: string };
// What a graphic is drawn with: its theme's look, the fonts its labels and details are in, each item's color in turn,
// and which of the video's graphics it is, `variant`, which picks how it's presented.
type Pen = { graphic: Graphic; label: { font: string; weight: number }; detail: { font: string; weight: number }; colors: string[]; variant: number };

// The size a graphic is rendered at for a layout, the band of it the graphic goes in, under the apps' top bar, above the
// captions, and above a presenter keyed out in front of it, and how big its title is. Laid over the presenter, it's
// rendered at the size of its window, so nothing in it is shrunk.
export function motionFrame(layout: Layout): Frame {
  if (layout === "split") return { width: WIDTH, height: SPLIT, top: 180, bottom: SPLIT - 40, title: 44 };
  if (layout === "overlay") return { width: OVER.width, height: OVER.height, top: 36, bottom: OVER.height - 36, title: 38 };
  if (layout === "green") return { width: WIDTH, height: HEIGHT, top: 210, bottom: 850, title: 44 };
  return { width: WIDTH, height: HEIGHT, top: 220, bottom: 1320, title: 44 };
}

// When each item comes on screen, in seconds into the graphic: as the presenter says its cue, found in `words`, each with
// when it's said, or for an item whose cue isn't said, spaced between its neighbors. Items come on in order, at least a
// third of a second apart, and a moment before the graphic ends.
export function cueTimes(motion: Motion, words: Array<{ text: string; start: number }>, seconds: number): number[] {
  const simple = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  let after = 0;
  const said = motion.items.map(({ cue }) => {
    const wanted = simple(cue);
    const at = wanted ? words.findIndex((word, index) => index >= after && (simple(word.text) === wanted || (wanted.length >= 4 && simple(word.text).startsWith(wanted)))) : -1;
    if (at < 0) return undefined;
    after = at + 1;
    return words[at].start;
  });
  const [first, last] = [0.35, Math.max(0.6, seconds * 0.7)];
  const times = said.map((time, index) => {
    if (time !== undefined) return time;
    const before = said.findLastIndex((each, at) => at < index && each !== undefined);
    const next = said.findIndex((each, at) => at > index && each !== undefined);
    const [from, fromTime] = before < 0 ? [-1, first] : [before, said[before]!];
    const [to, toTime] = next < 0 ? [said.length, last] : [next, said[next]!];
    return fromTime + ((toTime - fromTime) * (index - from)) / (to - from);
  });
  for (let index = 1; index < times.length; index++) times[index] = Math.max(times[index], times[index - 1] + 0.33);
  return times.map((time) => Math.min(Math.max(0, time), Math.max(0, seconds - 0.6)));
}

// Renders the graphic to `file`, `seconds` long, sized for `layout`, with item i coming on screen `times[i]` seconds in.
// `variant` is which of the video's graphics it is, from 0. HyperFrames renders it in headless Chrome, which it downloads
// the first time. A graphic rendered before is used again, and a render that stops partway isn't kept.
export async function renderMotion(motion: Motion, layout: Layout, seconds: number, times: number[], theme: Theme, file: string, signal?: AbortSignal, variant = 0): Promise<string> {
  if (existsSync(file)) return file;
  const dir = await mkdtemp(join(tmpdir(), "motion-"));
  try {
    await writeFile(join(dir, "index.html"), compositionOf(motion, motionFrame(layout), seconds, times, theme, variant));
    await Promise.all([...SCRIPTS, ...FONT_FILES.map((font) => font.file)].map((each) => copyFile(each, join(dir, basename(each)))));
    const rendering = resolve(`${file}.part.mp4`);
    await run(process.execPath, [HYPERFRAMES, "render", dir, "-o", rendering, "-f", "30"], {
      signal,
      timeout: 300_000,
      maxBuffer: 1 << 26,
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
    }).catch((error: { stderr?: string; message: string }) => {
      throw new Error(`HyperFrames couldn't render the graphic: ${(error.stderr || error.message).trim().split("\n").slice(-3).join(" ")}`);
    });
    await rename(rendering, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return file;
}

// The composition: the look's ground, with the grain of paper or chalk under a sketch or a newspaper's chart, the title,
// if there is one, the shapes, drawn when the page loads, under the words, and a paused timeline that HyperFrames seeks
// frame by frame, easing the whole graphic slowly closer as it plays.
function compositionOf(motion: Motion, frame: Frame, seconds: number, times: number[], theme: Theme, variant: number): string {
  const { width, height } = frame;
  const pen = penOf(theme, motion.items.length, variant);
  const { look, ground, ink, muted } = pen.graphic;
  const stage = { x: 64, y: frame.top, width: width - 128, height: frame.bottom - frame.top };
  const title = titleOf(motion, stage, frame.title, pen);
  const titled = motion.title ? Math.round(frame.title * (look === "sketch" ? 2.5 : 2.1)) : 0;
  const area = { x: stage.x, y: stage.y + titled, width: stage.width, height: stage.height - titled };
  const drawn = { flow: flowOf, hub: hubOf, bars: barsOf, steps: stepsOf, stat: statOf }[motion.style](motion, area, pen, seconds);
  const grain = { sketch: 0.1, editorial: 0.06, keynote: 0, neon: 0 }[look];
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
${SCRIPTS.map((each) => `<script src="${basename(each)}"></script>`).join("\n")}
<style>
${FONT_FILES.map(({ family, weight, file }) => `@font-face { font-family: ${family}; src: url("${basename(file)}"); font-weight: ${weight}; }`).join("\n")}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${ground}; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; color: ${ink}; }
.ground { position: absolute; inset: 0; background: ${ground}; }
.grain { position: absolute; inset: 0; opacity: ${grain}; mix-blend-mode: ${luminanceOf(ground) > 0.4 ? "multiply" : "screen"}; background-image: ${noise}; }
#stage { position: absolute; inset: 0; transform-origin: 50% 45%; }
#ink { position: absolute; left: 0; top: 0; overflow: visible; }
.title { position: absolute; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
.row { position: absolute; }
.t { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.t.center { align-items: center; text-align: center; padding: 14px 22px; }
.label { font-family: ${pen.label.font}; font-weight: ${pen.label.weight}; line-height: 1.08; overflow-wrap: break-word; }
.detail { font-family: ${pen.detail.font}; font-weight: ${pen.detail.weight}; line-height: 1.2; color: ${muted}; }
.num, .value { position: absolute; font-family: ${pen.label.font}; font-weight: ${pen.label.weight}; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
${look === "neon" ? ".label, .num, .value { color: #fff; text-shadow: 0 0 18px var(--c), 0 0 5px var(--c); }" : ""}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${seconds.toFixed(3)}" data-width="${width}" data-height="${height}">
<div class="ground"></div>
${grain ? `<div class="grain"></div>` : ""}
<div id="stage">
<svg id="ink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg>
${title.html}
${drawn.html}
</div>
</div>
<script>
const T = ${JSON.stringify(times.map((time) => Number(time.toFixed(3))))};
const LOOK = "${look}";
const SHAPES = ${JSON.stringify([...title.shapes, ...drawn.shapes].map((shape) => ({ ...shape, at: shape.at.map((each) => Number(each.toFixed(1))) })))};
const format = (decimals) => (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const within = (at, seconds) => Math.max(0.25, Math.min(seconds, ${seconds.toFixed(3)} - at - 0.15));
${DRAWING}
const tl = gsap.timeline({ paused: true });
tl.fromTo("#stage", { scale: 1 }, { scale: 1.035, duration: ${seconds.toFixed(3)}, ease: "none" }, 0);
${title.script}
${drawn.script}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}

// What the page runs before its timeline: draws each shape in SHAPES into the SVG under the words, by hand with
// Rough.js for a sketch, in hairlines for a newspaper's chart, or as glowing tubes for neon, and leaves every stroke
// undrawn, for the timeline to draw on. A keynote has no boxes, only thin lines and solid bars.
const DRAWING = `
const NS = "http://www.w3.org/2000/svg";
const ink = document.getElementById("ink");
const rc = LOOK === "sketch" ? rough.svg(ink) : null;
const [BOX, LINE] = { keynote: [0, 3.5], editorial: [3, 2.5], neon: [5, 4.5], sketch: [4.5, 4] }[LOOK];
function make(name, attributes) {
  const node = document.createElementNS(NS, name);
  for (const key in attributes) node.setAttribute(key, attributes[key]);
  return node;
}
function seedOf(id) {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  return hash || 1;
}
function headOf([x1, y1, x2, y2], size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return [angle + 2.6, angle - 2.6].map((turn) => [x2, y2, x2 + size * Math.cos(turn), y2 + size * Math.sin(turn)]);
}
function sketched({ id, kind, at: [a, b, c, d], color }) {
  const style = { stroke: color, strokeWidth: kind === "line" || kind === "arrow" ? LINE : BOX, roughness: 1.5, bowing: 1.2, seed: seedOf(id) };
  if (kind === "box") return rc.rectangle(a, b, c, d, style);
  if (kind === "ring") return rc.ellipse(a + c / 2, b + d / 2, c, d, style);
  if (kind === "bar" || kind === "column") return rc.rectangle(a, b, c, d, { ...style, fill: color, fillStyle: "hachure", hachureGap: 11, fillWeight: BOX * 0.55, hachureAngle: -41 });
  const group = make("g", {});
  group.appendChild(rc.line(a, b, c, d, style));
  if (kind === "arrow") for (const [p, q, r, s] of headOf([a, b, c, d], 26)) group.appendChild(rc.line(p, q, r, s, { ...style, seed: style.seed + 1 }));
  return group;
}
function plain({ kind, at: [a, b, c, d], color }) {
  const group = make("g", LOOK === "neon" ? { filter: "url(#glow)" } : {});
  const stroke = (width) => ({ stroke: color, "stroke-width": width, fill: "none", "stroke-linecap": LOOK === "editorial" ? "butt" : "round", "stroke-linejoin": "round", class: "s" });
  if (kind === "box") group.appendChild(make("rect", { x: a, y: b, width: c, height: d, rx: LOOK === "neon" ? 26 : 0, ...stroke(BOX) }));
  else if (kind === "ring") group.appendChild(make("ellipse", { cx: a + c / 2, cy: b + d / 2, rx: c / 2, ry: d / 2, ...stroke(BOX) }));
  else if (kind === "bar" || kind === "column") {
    const tube = LOOK === "neon" ? { "fill-opacity": 0.3, stroke: color, "stroke-width": LINE } : {};
    group.appendChild(make("rect", { x: a, y: b, width: c, height: d, rx: LOOK === "editorial" ? 0 : Math.min(c, d, LOOK === "neon" ? 48 : 28) / 2, fill: color, ...tube }));
  } else {
    group.appendChild(make("line", { x1: a, y1: b, x2: c, y2: d, ...stroke(LINE) }));
    if (kind === "arrow") for (const [p, q, r, s] of headOf([a, b, c, d], 20)) group.appendChild(make("line", { x1: p, y1: q, x2: r, y2: s, ...stroke(LINE) }));
  }
  return group;
}
for (const shape of SHAPES) {
  const drawn = LOOK === "sketch" ? sketched(shape) : plain(shape);
  drawn.setAttribute("id", shape.id);
  if (LOOK === "sketch") for (const path of drawn.querySelectorAll("path")) path.classList.add("s");
  ink.appendChild(drawn);
}
for (const stroke of ink.querySelectorAll(".s")) {
  const length = stroke.getTotalLength();
  stroke.style.strokeDasharray = length + " " + length;
  stroke.style.strokeDashoffset = String(length);
}
`;

function penOf(theme: Theme, count: number, variant: number): Pen {
  const { graphic } = theme;
  const font = graphic.font ?? `${theme.font}, ${SANS}`;
  const weight = { keynote: 900, sketch: 700, editorial: 700, neon: 800 }[graphic.look];
  const detail = graphic.look === "sketch" ? { font, weight: 700 } : graphic.look === "editorial" ? { font: `${theme.font}, ${SANS}`, weight: 400 } : { font: SANS, weight: 600 };
  const colors = Array.from({ length: count }, (_, index) => graphic.accents[index % graphic.accents.length]);
  return { graphic, label: { font, weight }, detail, colors, variant };
}

// The title, the look's way: small and spaced out over a keynote, written by hand and underlined, a newspaper chart's
// kicker over a rule, or a neon sign.
function titleOf(motion: Motion, stage: Box, size: number, pen: Pen): Drawn {
  if (!motion.title) return { html: "", shapes: [], script: "" };
  const { look, ink, muted, accents } = pen.graphic;
  const font = {
    keynote: `font: 800 ${Math.round(size * 0.74)}px ${pen.label.font}; letter-spacing: 0.16em; text-transform: uppercase; color: ${muted};`,
    sketch: `font: ${pen.label.weight} ${Math.round(size * 1.2)}px ${pen.label.font}; color: ${ink};`,
    editorial: `font: 800 ${Math.round(size * 0.72)}px ${SANS}; letter-spacing: 0.1em; text-transform: uppercase; color: ${accents[0]};`,
    neon: `font: 800 ${size}px ${pen.label.font}; letter-spacing: 0.05em; text-transform: uppercase; color: #fff; text-shadow: 0 0 18px ${accents[0]}, 0 0 5px ${accents[0]};`,
  }[look];
  const shapes: Shape[] = [];
  if (look === "sketch") {
    const long = Math.min(stage.width, widthOf(motion.title, Math.round(size * 1.2), pen.label.font, pen.label.weight) + 12);
    shapes.push({ id: "tu", kind: "line", at: [stage.x - 4, stage.y + size * 1.62, stage.x + long, stage.y + size * 1.5], color: accents[0] });
  }
  if (look === "editorial") shapes.push({ id: "tu", kind: "line", at: [stage.x, stage.y + size * 1.3, stage.x + stage.width, stage.y + size * 1.3], color: ink });
  return {
    html: `<div id="title" class="title" style="left:${stage.x}px; top:${stage.y}px; width:${stage.width}px; ${font.replaceAll('"', "'")}">${escape(motion.title)}</div>`,
    shapes,
    script: [enter(pen, "#title", "0.05"), ...shapes.map((shape) => draw(pen, shape, "0.3", 0.5))].join("\n"),
  };
}

// Steps with arrows between them: down a frame taller than it's wide, and across a wider one, in one row for up to three
// and in two for more, the second running back under the first. Each step comes on as it's said, and the arrow into it
// draws just before. On a keynote, the newest step is in color and the ones before it go back to plain.
function flowOf(motion: Motion, area: Box, pen: Pen, seconds: number): Drawn {
  const { look, ink, muted } = pen.graphic;
  const count = motion.items.length;
  const perRow = isWide(area) ? (count <= 3 ? count : Math.ceil(count / 2)) : 1;
  const rows = Math.ceil(count / perRow);
  const across = perRow > 1;
  const [gapX, gapY] = [80, across ? 72 : 66];
  const width = across ? (area.width - gapX * (perRow - 1)) / perRow : Math.min(area.width, 880);
  const height = rows === 1 ? Math.min(300, area.height * 0.8) : Math.min(across ? 220 : 196, (area.height - gapY * (rows - 1)) / rows);
  const left = area.x + (area.width - (perRow * width + (perRow - 1) * gapX)) / 2;
  const top = area.y + (area.height - (rows * height + (rows - 1) * gapY)) / 2;
  const boxes = motion.items.map((_, index) => {
    const row = Math.floor(index / perRow);
    const column = row % 2 ? perRow - 1 - (index % perRow) : index % perRow;
    return { x: left + column * (width + gapX), y: top + row * (height + gapY), width, height };
  });
  const size = fitText(motion.items, ...inside(width, height), Math.round(clamp(across ? Math.min(width / 5.5, height * 0.3) : height * 0.3, 28, 56)), pen);
  const outlines = boxes.flatMap((box, index): Shape[] => (look === "keynote" ? [] : [{ id: `b${index}`, kind: "box", at: [box.x, box.y, box.width, box.height], color: look === "editorial" ? ink : pen.colors[index] }]));
  const arrows = boxes.slice(1).map((box, index): Shape => ({ id: `a${index}`, kind: "arrow", at: link(boxes[index], box), color: look === "keynote" ? muted : look === "neon" ? pen.colors[index + 1] : ink }));
  const last = count - 1;
  const spice = spiced(pen) ? emphasize(pen, boxes[last], `#i${last}`, "center", landing(last, seconds)) : undefined;
  return {
    html: [spice?.html ?? "", ...boxes.map((box, index) => words(`i${index}`, box, motion.items[index], size, pen, "center", look === "keynote" ? pen.colors[index] : undefined))].join("\n"),
    shapes: [...outlines, ...arrows, ...(spice?.shapes ?? [])],
    script: [
      ...outlines.map((shape, index) => draw(pen, shape, `T[${index}]`)),
      ...boxes.map((_, index) => enter(pen, `#i${index}`, `T[${index}] + ${look === "keynote" ? 0 : 0.12}`)),
      ...(look === "keynote" ? boxes.slice(0, -1).map((_, index) => `tl.to("#i${index} .label", { color: "${ink}", duration: 0.35 }, T[${index + 1}]);`) : []),
      ...arrows.map((shape, index) => draw(pen, shape, `Math.max(T[${index}] + 0.2, T[${index + 1}] - 0.32)`, 0.3)),
      spice?.script ?? "",
    ].join("\n"),
  };
}

// The first item at the center, and the rest around it, each joined to the center by a spoke that draws just before it
// comes on. In a wide frame, the center is bigger and the ring around it flatter.
function hubOf(motion: Motion, area: Box, pen: Pen, seconds: number): Drawn {
  const { look, ink, muted } = pen.graphic;
  const [center, ...around] = motion.items;
  const [x, y] = [area.x + area.width / 2, area.y + area.height / 2];
  const wide = isWide(area);
  const diameter = wide ? Math.min(area.height * 0.42, area.width * 0.3) : Math.min(area.width, area.height) * 0.32;
  const [rx, ry] = wide ? [area.width * 0.36, area.height * 0.39] : [area.width * 0.35, Math.min(area.height * 0.37, area.width * 0.6)];
  const outer = { width: Math.min(300, area.width * (wide ? 0.3 : 0.34)), height: Math.min(132, area.height * (wide ? 0.24 : 0.2)) };
  const spots = around.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / around.length;
    return { x: x + rx * Math.cos(angle) - outer.width / 2, y: y + ry * Math.sin(angle) - outer.height / 2, ...outer };
  });
  const middle = { x: x - diameter / 2, y: y - diameter / 2, width: diameter, height: diameter };
  const spokes = spots.map((spot, index): Shape => {
    const [dx, dy] = [spot.x + outer.width / 2 - x, spot.y + outer.height / 2 - y];
    const length = Math.hypot(dx, dy);
    const [from, to] = [(diameter / 2 + 12) / length, Math.max(0, 1 - (outer.height / 2 + 18) / length)];
    return { id: `a${index}`, kind: "line", at: [x + dx * from, y + dy * from, x + dx * to, y + dy * to], color: look === "keynote" ? muted : look === "editorial" ? ink : pen.colors[index + 1] };
  });
  const outlines: Shape[] =
    look === "keynote"
      ? []
      : [
          { id: "r0", kind: "ring", at: [middle.x, middle.y, middle.width, middle.height], color: look === "editorial" ? ink : pen.colors[0] },
          ...spots.map((spot, index): Shape => ({ id: `b${index + 1}`, kind: "box", at: [spot.x, spot.y, spot.width, spot.height], color: look === "editorial" ? ink : pen.colors[index + 1] })),
        ];
  const size = fitText(around, ...inside(outer.width, outer.height), Math.round(clamp(outer.height * 0.3, 28, 44)), pen);
  // Words in the circle stay in its middle, where it's widest.
  const centered = fitText([center], inside(diameter, diameter)[0], diameter * 0.6, Math.round(clamp(diameter * 0.15, 28, 56)), pen);
  const last = around.length;
  const spice = spiced(pen) && last ? emphasize(pen, spots[last - 1], `#i${last}`, "center", landing(last, seconds)) : undefined;
  return {
    html: [
      spice?.html ?? "",
      words("i0", middle, center, look === "keynote" ? Math.round(centered * 1.15) : centered, pen, "center", look === "keynote" ? pen.colors[0] : undefined),
      ...spots.map((spot, index) => words(`i${index + 1}`, spot, around[index], size, pen, "center")),
    ].join("\n"),
    shapes: [...outlines, ...spokes, ...(spice?.shapes ?? [])],
    script: [
      ...outlines.map((shape, index) => draw(pen, shape, index ? `T[${index}]` : "T[0]")),
      enter(pen, "#i0", "T[0] + 0.1"),
      ...spokes.map((shape, index) => draw(pen, shape, `Math.max(T[0] + 0.2, T[${index + 1}] - 0.3)`, 0.3)),
      ...spots.map((_, index) => enter(pen, `#i${index + 1}`, `T[${index + 1}] + 0.1`)),
      spice?.script ?? "",
    ].join("\n"),
  };
}

// A bar for each number, as long as it is next to the biggest, with its label and its value counting up as it grows:
// across, each under its label, or, for every other graphic when there's room, standing up as columns. On a newspaper's
// chart, every bar is ink but the biggest.
function barsOf(motion: Motion, area: Box, pen: Pen, seconds: number): Drawn {
  const { look, ink } = pen.graphic;
  const count = motion.items.length;
  const biggest = Math.max(...motion.items.map((item) => Math.abs(item.value)), 1e-9);
  const top = motion.items.findIndex((item) => Math.abs(item.value) === biggest);
  const [before, after] = unitAround(motion.unit);
  const shown = (item: Item) => `${before}${item.value.toLocaleString("en-US")}${after}`;
  const colorOf = (index: number) => (look === "editorial" ? (index === top ? pen.graphic.accents[0] : ink) : pen.colors[index]);
  const standing = pen.variant % 2 === 1 && area.height >= 340;
  const html: string[] = [];
  const shapes: Shape[] = [];
  const script: string[] = [];
  let mark: Box = area;
  if (standing) {
    const slot = area.width / count;
    const thick = Math.round(Math.min(150, slot * 0.56));
    const size = fitText(motion.items.map((item) => ({ ...item, detail: "" })), slot - 12, 110, Math.round(clamp(slot * 0.16, 28, 44)), pen);
    const valueSize = Math.round(size * 1.15);
    const base = area.y + area.height - 120;
    const tallest = base - (area.y + valueSize * 1.6);
    motion.items.forEach((item, index) => {
      const length = Math.max(thick * 0.3, (tallest * Math.abs(item.value)) / biggest);
      const x = area.x + index * slot + (slot - thick) / 2;
      shapes.push({ id: `b${index}`, kind: "column", at: [x, base - length, thick, length], color: colorOf(index) });
      html.push(`<div id="l${index}" class="t center" style="${place({ x: area.x + index * slot, y: base + 6, width: slot, height: 114 })} padding: 0 6px; justify-content: flex-start;"><div class="label" style="font-size:${size}px">${escape(item.label)}</div></div>`);
      html.push(`<div id="w${index}" class="value" style="left:${f(area.x + index * slot)}px; width:${f(slot)}px; text-align:center; top:${f(base - length - valueSize * 1.25)}px; font-size:${valueSize}px; color:${colorOf(index)}; --c:${colorOf(index)};">${escape(before)}<span id="v${index}">0</span>${escape(after)}</div>`);
      if (index === top) mark = { x: area.x + index * slot + (slot - widthOf(shown(item), valueSize, pen.label.font, pen.label.weight)) / 2, y: base - length - valueSize * 1.25, width: widthOf(shown(item), valueSize, pen.label.font, pen.label.weight), height: valueSize };
    });
    if (look === "editorial") shapes.push({ id: "axis", kind: "line", at: [area.x, base, area.x + area.width, base], color: ink });
  } else {
    const row = Math.min(200, area.height / count);
    const thick = Math.round(clamp(row * 0.36, 22, 66));
    const size = Math.round(clamp(row * 0.34, 28, 48));
    const valueSize = Math.round(size * 1.15);
    const longest = Math.max(...motion.items.map((item) => widthOf(shown(item), valueSize, pen.label.font, pen.label.weight)));
    const room = area.width - 24 - longest;
    const first = area.y + (area.height - count * row) / 2;
    motion.items.forEach((item, index) => {
      const y = first + index * row;
      const length = Math.max(thick, (room * Math.abs(item.value)) / biggest);
      const detail = item.detail ? ` <span class="detail" style="font-size:${Math.round(size * 0.7)}px">${escape(item.detail)}</span>` : "";
      html.push(`<div id="l${index}" class="value" style="left:${f(area.x)}px; top:${f(y)}px; font-size:${size}px; color:${look === "neon" ? "#fff" : ink}; --c:${colorOf(index)};">${escape(item.label)}${detail}</div>`);
      shapes.push({ id: `b${index}`, kind: "bar", at: [area.x, y + size * 1.4, length, thick], color: colorOf(index) });
      html.push(`<div id="w${index}" class="value" style="left:${f(area.x + length + 22)}px; top:${f(y + size * 1.4 + thick / 2 - valueSize * 0.55)}px; font-size:${valueSize}px; color:${colorOf(index)}; --c:${colorOf(index)};">${escape(before)}<span id="v${index}">0</span>${escape(after)}</div>`);
      if (index === top) mark = { x: area.x + length + 22, y: y + size * 1.4 + thick / 2 - valueSize * 0.55, width: widthOf(shown(item), valueSize, pen.label.font, pen.label.weight), height: valueSize };
    });
    if (look === "editorial") shapes.push({ id: "axis", kind: "line", at: [area.x - 10, first + size * 1.2, area.x - 10, first + (count - 1) * row + size * 1.4 + thick + 8], color: ink });
  }
  if (shapes.some((shape) => shape.id === "axis")) script.push(draw(pen, shapes.find((shape) => shape.id === "axis")!, "T[0]", 0.4));
  motion.items.forEach((item, index) => {
    script.push(
      enter(pen, `#l${index}`, `T[${index}]`),
      draw(pen, shapes.find((shape) => shape.id === `b${index}`)!, `T[${index}]`, `within(T[${index}], 0.75)`),
      `tl.from("#w${index}", { opacity: 0, duration: 0.25 }, T[${index}] + 0.15);`,
      countUp(`v${index}`, item.value, `T[${index}]`, 0.75),
    );
  });
  const spice = spiced(pen) ? emphasize(pen, mark, `#w${top}`, "left", `Math.min(T[${top}] + 0.9, ${(seconds - 0.9).toFixed(2)})`) : undefined;
  return { html: [spice?.html ?? "", ...html].join("\n"), shapes: [...shapes, ...(spice?.shapes ?? [])], script: [...script, spice?.script ?? ""].join("\n") };
}

// The steps in order, each with its number, in a block in the middle of the frame: one column, or two side by side when
// a wide frame has four or more, which one column would make too small. In every other graphic, the step being said
// stands out and the ones before it fade back, like a list being read out.
function stepsOf(motion: Motion, area: Box, pen: Pen, seconds: number): Drawn {
  const { look, muted } = pen.graphic;
  const count = motion.items.length;
  const columns = isWide(area) && count >= 4 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const row = Math.min(200, area.height / rows);
  const most = Math.round(clamp(row * 0.36, 28, 54));
  const ringed = look === "sketch" || look === "neon";
  const numeral = (index: number) => (look === "keynote" ? String(index + 1).padStart(2, "0") : String(index + 1));
  const marker = ringed ? Math.round(Math.min(96, row * 0.58, most * 1.75)) : Math.round(widthOf(numeral(count - 1), most * 1.05, pen.label.font, pen.label.weight) + 4);
  const gap = 28;
  const column = (area.width - 64 * (columns - 1)) / columns;
  const size = fitText(motion.items, column - marker - gap, row - 12, most, pen);
  const small = Math.round(size * 0.62);
  const said = (item: Item) => Math.min(column - marker - gap, Math.max(widthOf(item.label, size, pen.label.font, pen.label.weight), item.detail ? widthOf(item.detail, small, pen.detail.font, pen.detail.weight) : 0));
  const block = columns === 1 ? marker + gap + Math.max(...motion.items.map(said)) : column;
  const left = area.x + (area.width - (columns * block + (columns - 1) * 64)) / 2;
  const top = area.y + (area.height - rows * row) / 2;
  const html: string[] = [];
  const shapes: Shape[] = [];
  const script: string[] = [];
  const spots = motion.items.map((item, index) => {
    const spot = { x: left + Math.floor(index / rows) * (block + 64), y: top + (index % rows) * row, width: block, height: row };
    const tall = textHeight(item, block - marker - gap, size, pen);
    const labelTop = (row - tall) / 2;
    const color = pen.colors[index];
    const number = ringed
      ? `<div class="num" style="left:0; top:${f((row - marker) / 2)}px; width:${marker}px; height:${marker}px; display:flex; align-items:center; justify-content:center; font-size:${Math.round(marker * 0.5)}px; color:${look === "sketch" ? color : "#fff"}; --c:${color};">${numeral(index)}</div>`
      : `<div class="num" style="left:0; top:${f(labelTop + size * 0.04)}px; font-size:${Math.round(size * 1.05)}px; color:${color};">${numeral(index)}</div>`;
    html.push(`<div id="s${index}" class="row" style="${place(spot)}">${number}${words(`w${index}`, { x: marker + gap, y: 0, width: block - marker - gap, height: row }, item, size, pen, "left")}</div>`);
    if (ringed) shapes.push({ id: `r${index}`, kind: "ring", at: [spot.x, spot.y + (row - marker) / 2, marker, marker], color });
    if (look === "editorial" && index % rows !== rows - 1 && index !== count - 1) shapes.push({ id: `u${index}`, kind: "line", at: [spot.x, spot.y + row - 2, spot.x + block, spot.y + row - 2], color: muted });
    return { x: spot.x + marker + gap, y: spot.y + labelTop, width: Math.min(block - marker - gap, widthOf(item.label, size, pen.label.font, pen.label.weight)), height: size * 1.08 };
  });
  motion.items.forEach((_, index) => {
    if (ringed) script.push(draw(pen, shapes.find((shape) => shape.id === `r${index}`)!, `T[${index}]`, 0.4));
    script.push(enter(pen, `#s${index}`, `T[${index}] + ${ringed ? 0.08 : 0}`));
    const rule = shapes.find((shape) => shape.id === `u${index}`);
    if (rule) script.push(draw(pen, rule, `T[${index}] + 0.2`, 0.4));
    if (pen.variant % 2 === 1 && index > 0) {
      const back = motion.items.slice(0, index).flatMap((__, earlier) => [`#s${earlier}`, ...(ringed ? [`#r${earlier}`] : [])]);
      script.push(`tl.to(${q(back.join(", "))}, { opacity: 0.3, duration: 0.3 }, T[${index}]);`);
    }
  });
  const last = count - 1;
  const spice = spiced(pen) ? emphasize(pen, spots[last], `#s${last}`, "left", landing(last, seconds)) : undefined;
  return { html: [spice?.html ?? "", ...html].join("\n"), shapes: [...shapes, ...(spice?.shapes ?? [])], script: [...script, spice?.script ?? ""].join("\n") };
}

// One big number, counting up from nothing as it's said, with what it is under it, as big as fits, marked the look's
// way once it lands: circled by hand, ruled under, or underlined in the accent.
function statOf(motion: Motion, area: Box, pen: Pen): Drawn {
  const { look, ink, accents } = pen.graphic;
  const [item] = motion.items;
  const [before, after] = unitAround(motion.unit);
  const text = `${before}${item.value.toLocaleString("en-US")}${after}`;
  const size = Math.round(Math.min(isWide(area) ? 170 : 230, area.height * 0.45, area.width / (text.length * 0.64)));
  const label = Math.round(clamp(size * 0.3, 34, 56));
  const wide = widthOf(text, size, pen.label.font, pen.label.weight);
  const under = textHeight(item, area.width, label, pen);
  const top = area.y + (area.height - (size * 1.12 + under)) / 2;
  const number = { x: area.x + (area.width - wide) / 2, y: top, width: wide, height: size };
  const color = look === "editorial" ? ink : accents[0];
  const shapes: Shape[] = [];
  if (look === "sketch") shapes.push({ id: "mark", kind: "ring", at: [number.x - 46, number.y - 30, number.width + 92, number.height + 50], color: accents[1 % accents.length] });
  if (look === "editorial") shapes.push({ id: "mark", kind: "line", at: [number.x, number.y + size * 1.04, number.x + number.width, number.y + size * 1.04], color: accents[0] });
  const underline = look === "keynote" ? `<div id="mark" style="position:absolute; ${place({ x: number.x, y: number.y + size * 1.02, width: number.width, height: 10 })} background:${accents[0]};"></div>` : "";
  return {
    html: [
      underline,
      `<div id="stat" class="value" style="left:${f(area.x)}px; width:${f(area.width)}px; top:${f(number.y)}px; text-align:center; font-size:${size}px; color:${color}; --c:${accents[0]};">${escape(before)}<span id="v0">0</span>${escape(after)}</div>`,
      words("what", { x: area.x, y: top + size * 1.12 - 14, width: area.width, height: under + 28 }, item, label, pen, "center"),
    ].join("\n"),
    shapes,
    script: [
      enter(pen, "#stat", "T[0]"),
      countUp("v0", item.value, "T[0]", 1.1),
      enter(pen, "#what", "T[0] + 0.3"),
      shapes.length ? draw(pen, shapes[0], "T[0] + 1", 0.6) : "",
      underline ? `tl.from("#mark", { scaleX: 0, transformOrigin: "0% 50%", duration: 0.45, ease: "power3.out" }, T[0] + 1);` : "",
    ].join("\n"),
  };
}

// An item's label, with its detail under it, in `box`: centered in it, as in a diagram, or from its left, as in a list.
// `color` colors the label, and a neon look glows in the item's color.
function words(id: string, box: Box, item: Item, size: number, pen: Pen, align: "center" | "left", color?: string): string {
  const detail = item.detail ? `<div class="detail" style="font-size:${Math.round(size * 0.62)}px">${escape(item.detail)}</div>` : "";
  const glow = color ?? pen.colors[Number(id.replace(/\D/g, "")) % pen.colors.length] ?? pen.colors[0];
  return `<div id="${id}" class="t${align === "center" ? " center" : ""}" style="${place(box)} --c:${glow};"><div class="label" style="font-size:${size}px;${color ? ` color:${color};` : ""}">${escape(item.label)}</div>${detail}</div>`;
}

// Brings words on the look's way, and every other graphic another way, so a video's graphics don't all arrive alike: on
// a keynote, rising or sliding in, in a sketch, written out or popped on, on a newspaper's chart, faded up or wiped on,
// and in neon, flickering or switched on.
function enter(pen: Pen, selector: string, at: string): string {
  const other = pen.variant % 2 === 1;
  const reveal = (inset: string, seconds: number, ease: string) =>
    `tl.fromTo(${q(selector)}, { clipPath: "inset(${inset.replace("R", "100%")})" }, { clipPath: "inset(${inset.replace("R", "-6%")})", duration: ${seconds}, ease: "${ease}" }, ${at});`;
  if (pen.graphic.look === "keynote") {
    return other ? `tl.from(${q(selector)}, { opacity: 0, x: -56, duration: 0.45, ease: "power3.out" }, ${at});` : `tl.from(${q(selector)}, { opacity: 0, y: 44, duration: 0.5, ease: "power3.out" }, ${at});`;
  }
  if (pen.graphic.look === "sketch") {
    return other ? `tl.from(${q(selector)}, { opacity: 0, scale: 0.55, rotation: -5, duration: 0.42, ease: "back.out(2.2)" }, ${at});` : reveal("-30% R -30% -6%", 0.55, "power1.inOut");
  }
  if (pen.graphic.look === "editorial") return other ? reveal("-12% R -12% -2%", 0.45, "power2.inOut") : `tl.from(${q(selector)}, { opacity: 0, y: 16, duration: 0.38, ease: "power2.out" }, ${at});`;
  return other
    ? reveal("-20% R -20% -10%", 0.35, "power2.out")
    : `tl.fromTo(${q(selector)}, { opacity: 0 }, { keyframes: [{ opacity: 1, duration: 0.04 }, { opacity: 0.15, duration: 0.06 }, { opacity: 1, duration: 0.04 }, { opacity: 0.45, duration: 0.05 }, { opacity: 1, duration: 0.1 }] }, ${at});`;
}

// Draws a shape on at `at`, over `seconds`: its strokes trace themselves as if drawn, and a solid bar grows from where it
// starts.
function draw(pen: Pen, shape: Shape, at: string, seconds: number | string = 0.45): string {
  if (pen.graphic.look !== "sketch" && (shape.kind === "bar" || shape.kind === "column")) {
    const grow = shape.kind === "bar" ? `scaleX: 0, transformOrigin: "0% 50%"` : `scaleY: 0, transformOrigin: "50% 100%"`;
    return `tl.from("#${shape.id}", { ${grow}, duration: ${seconds}, ease: "power2.out" }, ${at});`;
  }
  return `tl.to("#${shape.id} .s", { strokeDashoffset: 0, duration: ${seconds}, ease: "power1.inOut", stagger: 0.04 }, ${at});`;
}

// Whether this graphic marks its key item once it lands: every third graphic in a video does.
function spiced(pen: Pen): boolean {
  return pen.variant % 3 === 2;
}

// When the item at `index` has landed, to mark it, a moment before the graphic ends at the latest.
function landing(index: number, seconds: number): string {
  return `Math.min(T[${index}] + 0.6, ${(seconds - 0.9).toFixed(2)})`;
}

// Marks the key item, in `box`, at `at`, the look's way: a bar of the accent swept under it, or a pop of it in a diagram,
// on a keynote, a ring drawn around it by hand, a highlighter stroke behind it, or a pulse of light.
function emphasize(pen: Pen, box: Box, target: string, align: "center" | "left", at: string): Drawn {
  const { look, accents } = pen.graphic;
  const color = accents[0];
  if (look === "sketch") {
    const ring: Shape = { id: "em", kind: "ring", at: [box.x - 34, box.y - 24, box.width + 68, box.height + 48], color };
    return { html: "", shapes: [ring], script: draw(pen, ring, at, 0.7) };
  }
  if (look === "neon" || (look === "keynote" && align === "center")) {
    return { html: "", shapes: [], script: `tl.to(${q(target)}, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 3, ease: "sine.inOut" }, ${at});` };
  }
  const mark = look === "keynote" ? { x: box.x, y: box.y + box.height + 8, width: box.width, height: 10 } : { x: box.x - 10, y: box.y + box.height * 0.1, width: box.width + 20, height: box.height * 0.84 };
  return {
    html: `<div id="em" style="position:absolute; ${place(mark)} background:${color}; opacity:${look === "keynote" ? 1 : 0.24};"></div>`,
    shapes: [],
    script: `tl.from("#em", { scaleX: 0, transformOrigin: "0% 50%", duration: 0.45, ease: "power3.out" }, ${at});`,
  };
}

// The biggest size up to `size` at which every item's label, wrapped to lines `width` wide, and its detail under it fit
// `height`, with no word broken in two. Every item gets the same size, so they look alike.
function fitText(items: Item[], width: number, height: number, size: number, pen: Pen): number {
  for (let at = size; at > 22; at -= 2) if (items.every((item) => textHeight(item, width, at, pen) <= height)) return at;
  return 22;
}

function textHeight({ label, detail }: Item, width: number, size: number, pen: Pen): number {
  const small = Math.round(size * 0.62);
  const under = detail ? 6 + linesOf(detail, width, `${pen.detail.weight} ${small}px ${pen.detail.font}`) * small * 1.2 : 0;
  return linesOf(label, width, `${pen.label.weight} ${size}px ${pen.label.font}`) * size * 1.08 + under;
}

// How many lines `text` wraps to in `width`, the way the browser wraps it, or Infinity if a word is too wide for a line.
function linesOf(text: string, width: number, font: string): number {
  ruler.font = font;
  const space = ruler.measureText(" ").width;
  let [lines, used] = [1, 0];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wide = ruler.measureText(word).width;
    if (wide > width) return Infinity;
    if (used && used + space + wide > width) [lines, used] = [lines + 1, wide];
    else used += (used ? space : 0) + wide;
  }
  return lines;
}

function widthOf(text: string, size: number, font: string, weight: number): number {
  ruler.font = `${weight} ${size}px ${font}`;
  return ruler.measureText(text).width;
}

// The room for a node's words, inside its padding.
function inside(width: number, height: number): [number, number] {
  return [width - 54, height - 38];
}

// An arrow from one box to the next: across, between boxes side by side, or down, from a box to the one under it.
function link(from: Box, to: Box): number[] {
  const [fromX, fromY, toX, toY] = [from.x + from.width / 2, from.y + from.height / 2, to.x + to.width / 2, to.y + to.height / 2];
  if (Math.abs(toX - fromX) <= Math.abs(toY - fromY)) return [fromX, from.y + from.height + 12, toX, to.y - 16];
  const right = toX > fromX;
  return [right ? from.x + from.width + 14 : from.x - 14, fromY, right ? to.x - 16 : to.x + to.width + 16, toY];
}

// Whether a frame is wide enough for a graphic's items to go side by side rather than down it.
function isWide(area: Box): boolean {
  return area.width > area.height * 1.4;
}

function place(box: Box): string {
  return `left:${f(box.x)}px; top:${f(box.y)}px; width:${f(box.width)}px; height:${f(box.height)}px;`;
}

function f(value: number): string {
  return value.toFixed(1);
}

function q(text: string): string {
  return JSON.stringify(text);
}

function clamp(value: number, smallest: number, biggest: number): number {
  return Math.min(biggest, Math.max(smallest, value));
}

// Counts a number up from 0 to `value`, from `at`, with as many decimals as it has, over `seconds`, or less if the
// graphic ends sooner.
function countUp(id: string, value: number, at: string, seconds: number): string {
  const decimals = Math.min(2, (String(value).split(".")[1] ?? "").length);
  return `tl.fromTo("#${id}", { textContent: 0 }, { textContent: ${value}, duration: within(${at}, ${seconds}), ease: "power2.out", modifiers: { textContent: format(${decimals}) } }, ${at});`;
}

// A currency sign goes before the number, and any other unit after it, with a space if it's a word.
function unitAround(unit: string): [string, string] {
  if (!unit) return ["", ""];
  if (/^[$€£¥₹]$/.test(unit)) return [unit, ""];
  return ["", /^[a-z]{3,}/i.test(unit) ? ` ${unit}` : unit];
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
