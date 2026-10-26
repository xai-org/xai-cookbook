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
import { type Theme, inkOn } from "./themes.ts";

// Motion graphics, for beats that are clearer drawn out than shown, like a diagram of how something works or numbers to
// compare. Each one is a small HyperFrames composition: HTML laid out here from the beat's graphic, in the video's theme,
// with a GSAP timeline that brings each item on screen as the presenter says its cue word. HyperFrames renders it to a
// video in headless Chrome, and the video plays it like any clip.

const run = promisify(execFile);
const find = createRequire(import.meta.url).resolve;
// HyperFrames' command line, run with this Node, and GSAP, which is copied next to each composition so a render needs no
// network.
const HYPERFRAMES = join(dirname(find("hyperframes/package.json")), "bin/hyperframes.mjs");
const GSAP = find("gsap/dist/gsap.min.js");
const SANS = `"Helvetica Neue", "Segoe UI", "DejaVu Sans", Arial, sans-serif`;
// Measures words in the fonts the graphic is rendered in, which Chrome finds on this computer the same way.
const ruler = createCanvas(1, 1).getContext("2d");

type Box = { x: number; y: number; width: number; height: number };
type Frame = { width: number; height: number; top: number; bottom: number; title: number };
// A graphic's markup, and the GSAP calls that animate it, which read each item's time from T.
type Drawn = { html: string; script: string };

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
// HyperFrames renders it in headless Chrome, which it downloads the first time. A graphic rendered before is used again,
// and a render that stops partway isn't kept.
export async function renderMotion(motion: Motion, layout: Layout, seconds: number, times: number[], theme: Theme, file: string, signal?: AbortSignal): Promise<string> {
  if (existsSync(file)) return file;
  const dir = await mkdtemp(join(tmpdir(), "motion-"));
  try {
    await writeFile(join(dir, "index.html"), compositionOf(motion, motionFrame(layout), seconds, times, theme));
    await copyFile(GSAP, join(dir, "gsap.min.js"));
    await Promise.all(FONT_FILES.map((font) => copyFile(font.file, join(dir, basename(font.file)))));
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

// The composition: the plain dark of the rest of the video, with a faint grid of dots and a soft glow of the theme's
// first color, the title, if there is one, over the graphic, and a paused timeline that HyperFrames seeks frame by frame,
// easing the whole graphic slowly closer as it plays.
function compositionOf(motion: Motion, frame: Frame, seconds: number, times: number[], theme: Theme): string {
  const { width, height } = frame;
  const stage = { x: 64, y: frame.top, width: width - 128, height: frame.bottom - frame.top };
  const titled = motion.title ? Math.round(frame.title * 2.1) : 0;
  const area = { x: stage.x, y: stage.y + titled, width: stage.width, height: stage.height - titled };
  const colors = motion.items.map((_, index) => theme.colors[index % theme.colors.length]);
  const font = `${theme.font}, ${SANS}`;
  const drawn = { flow: flowOf, hub: hubOf, bars: barsOf, steps: stepsOf, stat: statOf }[motion.style](motion, area, colors, font);
  const glow = theme.glow ? "box-shadow: 0 0 36px color-mix(in srgb, var(--c) 55%, transparent);" : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
<script src="gsap.min.js"></script>
<style>
@font-face { font-family: Inter; src: url("Inter-ExtraBold.ttf"); font-weight: 800; }
@font-face { font-family: Inter; src: url("Inter-Black.ttf"); font-weight: 900; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #0b0b0f; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; color: #fff; font-family: ${font}; }
.ground { position: absolute; inset: 0; background-image: radial-gradient(rgb(255 255 255 / 0.07) 2px, transparent 2.5px), radial-gradient(circle at 50% 45%, color-mix(in srgb, ${theme.colors[0]} 22%, transparent), transparent 62%); background-size: 36px 36px, 100% 100%; }
#stage { position: absolute; inset: 0; transform-origin: 50% 45%; }
.title { position: absolute; left: ${stage.x}px; width: ${stage.width}px; top: ${stage.y}px; font-size: ${frame.title}px; font-weight: 900; letter-spacing: 0.03em; line-height: 1.1; text-transform: uppercase; color: ${theme.colors[0]}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node { position: absolute; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; padding: 14px 22px; text-align: center; border: 5px solid var(--c); border-radius: 28px; background: #15151d; ${glow} }
.round { border-radius: 50%; }
.label { font-weight: 900; line-height: 1.06; overflow-wrap: break-word; }
.detail { font-family: ${SANS}; font-weight: 600; line-height: 1.2; color: rgb(255 255 255 / 0.72); }
.fill { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.columns { display: flex; max-width: 100%; }
.column { display: flex; flex-direction: column; min-width: 0; }
.step { display: flex; align-items: center; gap: 26px; }
.step > div:last-child { min-width: 0; }
.number { font-weight: 900; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
.badge { flex: none; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--c); color: var(--ink); font-weight: 900; ${glow} }
.bar { position: absolute; border-radius: 9999px; background: var(--c); ${glow} }
.value { position: absolute; font-weight: 900; white-space: nowrap; }
svg { position: absolute; inset: 0; overflow: visible; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${seconds.toFixed(3)}" data-width="${width}" data-height="${height}">
<div class="ground"></div>
<div id="stage">
${motion.title ? `<div id="title" class="title">${escape(motion.title)}</div>` : ""}
${drawn.html}
</div>
</div>
<script>
const T = ${JSON.stringify(times.map((time) => Number(time.toFixed(3))))};
const format = (decimals) => (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const within = (at, seconds) => Math.max(0.25, Math.min(seconds, ${seconds.toFixed(3)} - at - 0.15));
const tl = gsap.timeline({ paused: true });
tl.fromTo("#stage", { scale: 1 }, { scale: 1.035, duration: ${seconds.toFixed(3)}, ease: "none" }, 0);
${motion.title ? `tl.from("#title", { opacity: 0, y: -14, duration: 0.4, ease: "power2.out" }, 0.05);` : ""}
${drawn.script}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}

// Steps with arrows between them: down a frame taller than it's wide, and across a wider one, in one row for up to three
// and in two for more, the second running back under the first. Each step pops in as it's said, and the arrow into it
// draws just before.
function flowOf(motion: Motion, area: Box, colors: string[], font: string): Drawn {
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
  const size = fitText(motion.items, ...inside(width, height), Math.round(clamp(across ? Math.min(width / 5.5, height * 0.3) : height * 0.3, 28, 56)), font);
  const arrows = boxes.slice(1).map((box, index) => link(boxes[index], box));
  return {
    html: `${svg(arrows.map((each, index) => each.svg(`a${index}`, colors[index + 1])))}${boxes.map((box, index) => node(`i${index}`, box, motion.items[index], colors[index], size)).join("")}`,
    script: [
      ...boxes.map((_, index) => `tl.from("#i${index}", { opacity: 0, scale: 0.86, duration: 0.42, ease: "back.out(1.7)" }, T[${index}]);`),
      ...arrows.map((each, index) => each.script(`a${index}`, `Math.max(T[${index}] + 0.2, T[${index + 1}] - 0.32)`)),
    ].join("\n"),
  };
}

// The first item in a circle at the center, and the rest around it, each with a spoke to the center that draws just
// before it pops in. In a wide frame, the circle is bigger and the ring around it flatter.
function hubOf(motion: Motion, area: Box, colors: string[], font: string): Drawn {
  const [center, ...around] = motion.items;
  const [x, y] = [area.x + area.width / 2, area.y + area.height / 2];
  const wide = isWide(area);
  const diameter = wide ? Math.min(area.height * 0.42, area.width * 0.3) : Math.min(area.width, area.height) * 0.32;
  const [rx, ry] = wide ? [area.width * 0.36, area.height * 0.39] : [area.width * 0.35, Math.min(area.height * 0.37, area.width * 0.6)];
  const outer = { width: Math.min(300, area.width * (wide ? 0.3 : 0.34)), height: Math.min(132, area.height * (wide ? 0.24 : 0.2)) };
  const spots = around.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / around.length;
    return [x + rx * Math.cos(angle), y + ry * Math.sin(angle)];
  });
  const spokes = spots.map(([toX, toY]) => {
    const [dx, dy] = [toX - x, toY - y];
    const length = Math.hypot(dx, dy);
    const [startShare, endShare] = [(diameter / 2 + 12) / length, Math.max(0, 1 - (outer.height / 2 + 18) / length)];
    return arrow([x + dx * startShare, y + dy * startShare], [x + dx * endShare, y + dy * endShare], false);
  });
  const size = fitText(around, ...inside(outer.width, outer.height), Math.round(clamp(outer.height * 0.3, 28, 44)), font);
  // Words in the circle stay in its middle, where it's widest.
  const middle = fitText([center], inside(diameter, diameter)[0], diameter * 0.6, Math.round(clamp(diameter * 0.15, 28, 56)), font);
  return {
    html: [
      svg(spokes.map((each, index) => each.svg(`a${index}`, colors[index + 1]))),
      node("i0", { x: x - diameter / 2, y: y - diameter / 2, width: diameter, height: diameter }, center, colors[0], middle, "round"),
      ...spots.map(([spotX, spotY], index) => node(`i${index + 1}`, { x: spotX - outer.width / 2, y: spotY - outer.height / 2, ...outer }, around[index], colors[index + 1], size)),
    ].join(""),
    script: [
      `tl.from("#i0", { opacity: 0, scale: 0.7, duration: 0.45, ease: "back.out(1.7)" }, T[0]);`,
      ...spots.map((_, index) => `${spokes[index].script(`a${index}`, `Math.max(T[0] + 0.2, T[${index + 1}] - 0.3)`)}\ntl.from("#i${index + 1}", { opacity: 0, scale: 0.8, duration: 0.4, ease: "back.out(1.7)" }, T[${index + 1}]);`),
    ].join("\n"),
  };
}

// A bar for each number, as long as it is next to the biggest, with its label over it and its value counting up at its
// end as it grows.
function barsOf(motion: Motion, area: Box, colors: string[]): Drawn {
  const count = motion.items.length;
  const biggest = Math.max(...motion.items.map((item) => Math.abs(item.value)), 1e-9);
  const row = Math.min(200, area.height / count);
  const thick = Math.round(clamp(row * 0.36, 22, 66));
  const size = Math.round(clamp(row * 0.34, 28, 48));
  const top = area.y + (area.height - count * row) / 2;
  const [before, after] = unitAround(motion.unit);
  // The longest bar leaves room after it for the longest value.
  const longest = Math.max(...motion.items.map((item) => `${before}${item.value.toLocaleString("en-US")}${after}`.length));
  const room = area.width - 22 - longest * size * 1.15 * 0.64;
  const html = motion.items.map((item, index) => {
    const y = top + index * row;
    const length = Math.max(thick, (room * Math.abs(item.value)) / biggest);
    return `<div id="l${index}" class="value" style="left:${area.x}px; top:${y}px; font-size:${size}px;">${escape(item.label)}${item.detail ? ` <span class="detail" style="font-size:${Math.round(size * 0.7)}px">${escape(item.detail)}</span>` : ""}</div>
<div id="b${index}" class="bar" style="--c:${colors[index]}; left:${area.x}px; top:${y + size * 1.4}px; width:${length}px; height:${thick}px;"></div>
<div id="w${index}" class="value" style="left:${area.x + length + 22}px; top:${y + size * 1.4 + thick / 2 - size * 0.62}px; font-size:${Math.round(size * 1.15)}px; color:${colors[index]};">${escape(before)}<span id="v${index}">0</span>${escape(after)}</div>`;
  });
  return {
    html: html.join("\n"),
    script: motion.items
      .map((item, index) => {
        const length = Math.max(thick, (room * Math.abs(item.value)) / biggest);
        return [
          `tl.from("#l${index}", { opacity: 0, x: -24, duration: 0.3, ease: "power2.out" }, T[${index}]);`,
          `tl.fromTo("#b${index}", { width: 0 }, { width: ${length.toFixed(1)}, duration: within(T[${index}], 0.75), ease: "power2.out" }, T[${index}]);`,
          `tl.from("#w${index}", { opacity: 0, duration: 0.25 }, T[${index}] + 0.15);`,
          countUp(`v${index}`, item.value, `T[${index}]`, 0.75),
        ].join("\n");
      })
      .join("\n"),
  };
}

// The steps in order, each with its number in a circle of its color, sliding in as it's said, in a block in the middle of
// the frame: one column, or two side by side when a wide frame has four or more, which one column would make too small.
function stepsOf(motion: Motion, area: Box, colors: string[], font: string): Drawn {
  const count = motion.items.length;
  const columns = isWide(area) && count >= 4 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const row = Math.min(200, area.height / rows);
  const most = Math.round(clamp(row * 0.36, 28, 54));
  const badge = Math.round(Math.min(100, row * 0.6, most * 1.8));
  const size = fitText(motion.items, (area.width - 64 * (columns - 1)) / columns - badge - 26, row - 12, most, font);
  const step = (item: Motion["items"][number], index: number) => `<div id="s${index}" class="step" style="min-height:${row.toFixed(1)}px">
<div class="badge" style="--c:${colors[index]}; --ink:${inkOn(colors[index])}; width:${badge}px; height:${badge}px; font-size:${Math.round(badge * 0.5)}px;">${index + 1}</div>
<div><div class="label" style="font-size:${size}px">${escape(item.label)}</div>${item.detail ? `<div class="detail" style="font-size:${Math.round(size * 0.62)}px; margin-top:6px">${escape(item.detail)}</div>` : ""}</div>
</div>`;
  const column = (first: number) => `<div class="column">${motion.items.slice(first, first + rows).map((item, at) => step(item, first + at)).join("\n")}</div>`;
  return {
    html: `<div class="fill" style="${place(area)}"><div class="columns" style="gap:64px">${Array.from({ length: columns }, (_, index) => column(index * rows)).join("\n")}</div></div>`,
    script: motion.items.map((_, index) => `tl.from("#s${index}", { opacity: 0, x: -60, duration: 0.42, ease: "power3.out" }, T[${index}]);`).join("\n"),
  };
}

// One big number, counting up from nothing as it's said, with what it is under it, as big as fits.
function statOf(motion: Motion, area: Box, colors: string[]): Drawn {
  const [item] = motion.items;
  const [before, after] = unitAround(motion.unit);
  const characters = `${before}${item.value.toLocaleString("en-US")}${after}`.length;
  const size = Math.round(Math.min(isWide(area) ? 170 : 230, area.height * 0.45, area.width / (characters * 0.64)));
  const label = Math.round(clamp(size * 0.3, 34, 56));
  return {
    html: `<div class="fill" style="${place(area)}">
<div id="stat" class="number" style="font-size:${size}px; color:${colors[0]};">${escape(before)}<span id="v0">0</span>${escape(after)}</div>
<div id="what" style="margin-top:${Math.round(size * 0.12)}px; text-align:center;"><div class="label" style="font-size:${label}px">${escape(item.label)}</div>${item.detail ? `<div class="detail" style="font-size:${Math.round(label * 0.62)}px; margin-top:12px">${escape(item.detail)}</div>` : ""}</div>
</div>`,
    script: [
      `tl.from("#stat", { opacity: 0, scale: 0.82, duration: 0.45, ease: "back.out(1.6)" }, T[0]);`,
      countUp("v0", item.value, "T[0]", 1.1),
      `tl.from("#what", { opacity: 0, y: 24, duration: 0.4, ease: "power2.out" }, T[0] + 0.3);`,
    ].join("\n"),
  };
}

// A step, or the center of a hub, in a box bordered in its color.
function node(id: string, box: Box, item: Motion["items"][number], color: string, size: number, shape = ""): string {
  const detail = item.detail ? `<div class="detail" style="font-size:${Math.round(size * 0.62)}px">${escape(item.detail)}</div>` : "";
  return `<div id="${id}" class="node ${shape}" style="--c:${color}; left:${box.x.toFixed(1)}px; top:${box.y.toFixed(1)}px; width:${box.width.toFixed(1)}px; height:${box.height.toFixed(1)}px;"><div class="label" style="font-size:${size}px">${escape(item.label)}</div>${detail}</div>`;
}

// A line from one point to another that draws itself, with an arrowhead at its end that shows once it's drawn, unless
// it's a spoke. It's hidden until it starts drawing, since a round end draws a dot even where none of the line shows.
function arrow([fromX, fromY]: number[], [toX, toY]: number[], head = true) {
  const length = Math.hypot(toX - fromX, toY - fromY);
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const tip = (turn: number, back: number) => `${(toX - back * Math.cos(angle + turn)).toFixed(1)},${(toY - back * Math.sin(angle + turn)).toFixed(1)}`;
  return {
    svg: (id: string, color: string) =>
      `<path id="${id}" d="M${fromX.toFixed(1)} ${fromY.toFixed(1)} L${toX.toFixed(1)} ${toY.toFixed(1)}" stroke="${color}" stroke-width="7" stroke-linecap="round" fill="none" stroke-dasharray="${length.toFixed(1)}" stroke-dashoffset="${length.toFixed(1)}" opacity="0"/>` +
      (head ? `<polygon id="${id}h" points="${toX.toFixed(1)},${toY.toFixed(1)} ${tip(0.5, 26)} ${tip(-0.5, 26)}" fill="${color}" opacity="0"/>` : ""),
    script: (id: string, at: string) =>
      `tl.set("#${id}", { attr: { opacity: 1 } }, ${at});\ntl.to("#${id}", { attr: { "stroke-dashoffset": 0 }, duration: 0.32, ease: "power2.inOut" }, ${at});` +
      (head ? `\ntl.to("#${id}h", { attr: { opacity: 1 }, duration: 0.08 }, ${at} + 0.26);` : ""),
  };
}

// An arrow from one box to the next: across, between boxes side by side, or down, from a box to the one under it.
function link(from: Box, to: Box) {
  const [fromX, fromY, toX, toY] = [from.x + from.width / 2, from.y + from.height / 2, to.x + to.width / 2, to.y + to.height / 2];
  if (Math.abs(toX - fromX) <= Math.abs(toY - fromY)) return arrow([fromX, from.y + from.height + 12], [toX, to.y - 16]);
  const right = toX > fromX;
  return arrow([right ? from.x + from.width + 14 : from.x - 14, fromY], [right ? to.x - 16 : to.x + to.width + 16, toY]);
}

function svg(paths: string[]): string {
  return `<svg width="100%" height="100%">${paths.join("")}</svg>`;
}

// The biggest size up to `size` at which every item's label in `font`, wrapped to lines `width` wide, and its detail under
// it fit `height`, with no word broken in two. Every item gets the same size, so they look alike.
function fitText(items: Motion["items"], width: number, height: number, size: number, font: string): number {
  for (let at = size; at > 22; at -= 2) if (items.every((item) => textHeight(item, width, at, font) <= height)) return at;
  return 22;
}

function textHeight({ label, detail }: Motion["items"][number], width: number, size: number, font: string): number {
  const small = Math.round(size * 0.62);
  const under = detail ? 8 + linesOf(detail, width, `600 ${small}px ${SANS}`) * small * 1.2 : 0;
  return linesOf(label, width, `900 ${size}px ${font}`) * size * 1.06 + under;
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

// The room for a node's words, inside its border and padding.
function inside(width: number, height: number): [number, number] {
  return [width - 54, height - 38];
}

// Whether a frame is wide enough for a graphic's items to go side by side rather than down it.
function isWide(area: Box): boolean {
  return area.width > area.height * 1.4;
}

function place(box: Box): string {
  return `left:${box.x}px; top:${box.y}px; width:${box.width}px; height:${box.height}px;`;
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
