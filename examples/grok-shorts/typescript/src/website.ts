import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Canvas, createCanvas, loadImage } from "@napi-rs/canvas";
import { SpaceXAI } from "@xai-official/sdk";
import { FONTS } from "./brand.ts";
import { renderedHtml, screenshotSite } from "./media.ts";
import { THEMES, THEME_IDS } from "./themes.ts";

const client = new SpaceXAI({ maxRetries: 3 });

// A brand kit read off a website: the brand's name, colors, font, the look that suits it, a call to action for the end
// card, and its logo as a transparent PNG, if one of the images it could be works small on a dark video. `note` is Grok's
// sentence on what it found.
export type SiteBrand = { name: string; colors: string[]; font: string; look: string; glow: boolean; line: string; logo?: Buffer; note: string; cost: number };

type Facts = { url: string; title: string; siteName: string; themeColor: string; handle: string; fonts: string[] };
type Candidate = { from: string; svg?: string; url?: string };

// The longest side a logo is drawn at, which is about as big as the end card shows it.
const LOGO_EDGE = 640;
const MAX_CANDIDATES = 6;
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
// What a page says when a bot check turned the request away instead of serving the site.
const BLOCKED = /Attention Required|Just a moment|challenge-platform|cf-chl/i;

const SYSTEM = `You set up a creator's brand kit for their short videos, from their website. You get facts read from the site's HTML, a screenshot of the top of it, and the images that might be its logo, numbered, each drawn on a dark background the way it would sit on the video.

Return:
- name: the brand's name the way it writes it, short, without a tagline.
- colors: one to three hex colors that are most recognizably theirs, the main brand or accent color first, taken from the logo, buttons, links, and headings, not from photos, product screenshots, or illustrations on the page. Leave out white, black, and grays, unless the brand is only black and white, and then return white.
- font: the one of these closest in feel to the site's type: ${FONTS.map((font) => `${font.id} (${font.feel})`).join(", ")}. When the fonts the site uses are listed, go by their names before the screenshot.
- look: the drawing style for stickers and captions that suits the brand: ${THEME_IDS.map((id) => `${id} (${THEMES[id].summary})`).join(" ")}
- glow: true only if the site itself uses glowing, neon colors.
- line: a call to action for the end card, under 40 characters, like "Follow @handle for more" with their X account if there is one, or "Try it at example.com" with their domain.
- logo: the number of the image that is their logo and reads well small on a dark video, a wordmark or mark with a transparent background, or 0 if none does.
- note: one short sentence for the creator on what you found.`;

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    colors: { type: "array", items: { type: "string" } },
    font: { type: "string", enum: FONTS.map((font) => font.id) },
    look: { type: "string", enum: [...THEME_IDS] },
    glow: { type: "boolean" },
    line: { type: "string" },
    logo: { type: "integer" },
    note: { type: "string" },
  },
  required: ["name", "colors", "font", "look", "glow", "line", "logo", "note"],
  additionalProperties: false,
};

// Reads the website at `address`, like "x.ai", for a brand kit. The HTML comes from Chrome after the page's scripts have
// run, or from a plain request if Chrome is turned away too, and a screenshot of the page goes with it. Either one is
// enough on its own.
export async function brandFromWebsite(address: string, signal?: AbortSignal): Promise<SiteBrand> {
  const url = websiteUrl(address);
  const folder = await mkdtemp(join(tmpdir(), "brand-"));
  try {
    const [rendered, fetched, screenshot] = await Promise.all([
      renderedHtml(url.href, signal).catch(() => ""),
      fetch(url, { headers: { "user-agent": BROWSER, accept: "text/html" }, signal: timeout(15_000, signal) })
        .then((response) => (response.ok ? response.text() : ""))
        .catch(() => ""),
      screenshotSite(url.href, join(folder, "site.png"), signal)
        .then(async (file) => new Blob([await readFile(file)], { type: "image/png" }))
        .catch(() => undefined),
    ]);
    const html = [rendered, fetched].find((each) => each && !BLOCKED.test(each.slice(0, 20_000))) ?? "";
    if (!html && !screenshot) throw new Error(`${url.host} didn't open, so there's no brand to read from it.`);
    const facts = { ...readFacts(html, url), fonts: await fontsOf(html, url, signal) };
    const drawn = (await Promise.all(candidatesIn(html, url, facts.siteName).map((candidate) => logoCanvas(candidate, signal).then((canvas) => canvas && { ...candidate, canvas })))).filter(
      (each): each is Candidate & { canvas: Canvas } => each !== undefined,
    );
    const content = [
      { type: "input_text" as const, text: describe(facts) },
      ...(screenshot ? [{ type: "input_text" as const, text: "The top of the site:" }, { type: "input_image" as const, image: screenshot, detail: "high" as const }] : []),
      ...drawn.flatMap(({ from, canvas }, index) => [
        { type: "input_text" as const, text: `Logo ${index + 1}, ${from}:` },
        { type: "input_image" as const, image: new Blob([new Uint8Array(onDark(canvas).toBuffer("image/png"))], { type: "image/png" }), detail: "low" as const },
      ]),
    ];
    const response = await client.responses.create(
      {
        model: "grok-4.7",
        input: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: "brand", schema: SCHEMA } },
        reasoning: { effort: "low" },
      },
      { signal },
    );
    const read = response.toJson() as { name: string; colors: string[]; font: string; look: string; glow: boolean; line: string; logo: number; note: string };
    const hexes = (colors: string[]) => [...new Set(colors.map((color) => color.trim().toLowerCase()).filter((color) => /^#[0-9a-f]{6}$/.test(color)))].slice(0, 3);
    const colors = hexes(read.colors).length ? hexes(read.colors) : hexes([facts.themeColor]);
    const logo = drawn[read.logo - 1]?.canvas;
    return {
      name: read.name.trim().slice(0, 40),
      colors: colors.length ? colors : ["#ffffff"],
      font: read.font,
      look: read.look,
      glow: read.glow,
      line: read.line.trim().slice(0, 60),
      logo: logo && logo.toBuffer("image/png"),
      note: read.note.trim(),
      cost: response.usage.cost_usd ?? 0,
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function websiteUrl(address: string): URL {
  const trimmed = address.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes(".")) return url;
  } catch {}
  throw new Error(`"${address}" isn't a website. Try one like x.ai or https://example.com.`);
}

function timeout(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

// What the HTML says about the brand: its name, the color it asks browsers to tint the page, and its X account.
function readFacts(html: string, url: URL): Omit<Facts, "fonts"> {
  const tags = (name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
  const meta = (key: string) => tags("meta").find((tag) => (attrOf(tag, "property") || attrOf(tag, "name")).toLowerCase() === key);
  const content = (key: string) => decode(attrOf(meta(key) ?? "", "content"));
  const linked = [...html.matchAll(/href=["']https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(\w{1,15})["'/?]/gi)].map((match) => match[1]).find((name) => !/^(intent|share|home|i|search|hashtag)$/i.test(name));
  const handle = content("twitter:site").replace(/^@/, "") || linked || "";
  return {
    url: url.href,
    title: decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim(),
    siteName: content("og:site_name") || content("application-name"),
    themeColor: content("theme-color"),
    handle: handle && `@${handle}`,
  };
}

// The fonts a site uses, the most used first, from its own CSS and up to three stylesheets it links, with the names build
// tools give them cleaned up, like __GeistSans_3a0388 into Geist Sans. Sites often declare their fonts only in those
// stylesheets, behind CSS variables.
async function fontsOf(html: string, base: URL, signal?: AbortSignal): Promise<string[]> {
  const sheets = (html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => attrOf(tag, "rel").toLowerCase().includes("stylesheet"))
    .map((tag) => {
      try {
        return new URL(decode(attrOf(tag, "href")), base).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .slice(0, 3);
  const linked = await Promise.all(sheets.map((href) => fetch(href, { headers: { "user-agent": BROWSER }, signal: timeout(8_000, signal) }).then((response) => (response.ok ? response.text() : "")).catch(() => "")));
  const css = [html, ...linked].join("\n");
  const counts = new Map<string, number>();
  const count = (raw: string) => {
    const name = fontName(raw);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const match of css.matchAll(/(?:font-family|--font[\w-]*)\s*:\s*([^;}]+)/gi)) count(match[1].split(",")[0]);
  for (const match of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) for (const family of decode(match[1]).matchAll(/family=([^:&]+)/g)) count(family[1].replaceAll("+", " "));
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 6);
}

// A font family the way a person would name it, or nothing for a CSS variable, a generic family, an emoji or icon font,
// or the system's own font.
function fontName(raw: string): string {
  const name = raw
    .replace(/["']/g, "")
    .trim()
    .replace(/^_+/, "")
    .replace(/(_Fallback)?_[0-9a-f]{5,}$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s(VF|Var|Variable)$/i, "")
    .trim();
  if (!name || name.length < 3 || /[()!]/.test(name)) return "";
  if (/^(inherit|initial|unset|revert|system ui|sans serif|serif|monospace|cursive|fantasy|ui (sans serif|serif|monospace|rounded)|apple system|blink mac system font|segoe ui( emoji| symbol)?|apple color emoji|noto color emoji|emoji)$/i.test(name)) return "";
  return /icon|awesome|symbols|emoji/i.test(name) ? "" : name;
}

function describe(facts: Facts): string {
  const lines = [
    `Website: ${facts.url}`,
    facts.title && `Page title: ${facts.title}`,
    facts.siteName && `Site name: ${facts.siteName}`,
    facts.themeColor && `Theme color: ${facts.themeColor}`,
    facts.handle && `X account: ${facts.handle}`,
    facts.fonts.length ? `Fonts it uses: ${facts.fonts.join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// The images that might be the logo, likeliest first: SVGs in the page next to the word "logo" or named after the site,
// images called a logo, the site's SVG icon, its app icon, and the picture it shares on social media.
function candidatesIn(html: string, base: URL, siteName: string): Candidate[] {
  const resolve = (href: string) => {
    try {
      return href ? new URL(decode(href), base).href : undefined;
    } catch {
      return undefined;
    }
  };
  const named = siteName ? new RegExp(siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : undefined;
  const inline = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)]
    .filter((match) => match[0].length < 60_000)
    .filter((match) => /logo/i.test(html.slice(Math.max(0, match.index - 400), match.index) + match[0].slice(0, 400)) || named?.test(match[0].slice(0, 400)))
    .slice(0, 2)
    .map((match): Candidate => ({ from: "an SVG in the page", svg: match[0] }));
  const images = (html.match(/<img\b[^>]*>/gi) ?? [])
    .filter((tag) => /logo/i.test(attrOf(tag, "src") + attrOf(tag, "alt") + attrOf(tag, "class") + attrOf(tag, "id")))
    .slice(0, 2)
    .map((tag): Candidate => ({ from: `an image called "${attrOf(tag, "alt") || "logo"}"`, url: resolve(attrOf(tag, "src")) }));
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const rel = (tag: string) => attrOf(tag, "rel").toLowerCase();
  const icon = links
    .filter((tag) => rel(tag) === "mask-icon" || (rel(tag).includes("icon") && /\.svg(\?|$)|svg/i.test(attrOf(tag, "href") + attrOf(tag, "type"))))
    .map((tag): Candidate => ({ from: "the site's SVG icon", url: resolve(attrOf(tag, "href")) }));
  const touch = links
    .filter((tag) => rel(tag).includes("apple-touch-icon"))
    .sort((a, b) => Number.parseInt(attrOf(b, "sizes")) - Number.parseInt(attrOf(a, "sizes")) || 0)
    .slice(0, 1)
    .map((tag): Candidate => ({ from: "the site's app icon", url: resolve(attrOf(tag, "href")) }));
  const shared = (html.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) => attrOf(tag, "property").toLowerCase() === "og:image").slice(0, 1).map((tag): Candidate => ({ from: "the picture it shares on social media", url: resolve(attrOf(tag, "content")) }));
  return [...inline, ...images, ...icon, ...touch, ...shared].filter((candidate) => candidate.svg || candidate.url).slice(0, MAX_CANDIDATES);
}

// A candidate drawn on a transparent canvas, LOGO_EDGE on its longest side, or nothing if it can't be read or comes out
// empty, like an SVG that only points at shapes defined elsewhere in the page. ICO and GIF icons are skipped.
async function logoCanvas(candidate: Candidate, signal?: AbortSignal): Promise<Canvas | undefined> {
  try {
    let svg = candidate.svg;
    let bytes: Buffer | undefined;
    if (candidate.url) {
      const response = await fetch(candidate.url, { headers: { "user-agent": BROWSER }, signal: timeout(10_000, signal) });
      if (!response.ok) return undefined;
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 3 * 1024 * 1024) return undefined;
      const start = bytes.subarray(0, 512).toString("utf8");
      if (/<svg/i.test(start)) svg = bytes.toString("utf8");
      else if (!isRaster(bytes)) return undefined;
    }
    const image = await loadImage(svg ? Buffer.from(sizedSvg(svg)) : bytes!);
    if (!image.width || !image.height) return undefined;
    const scale = Math.min(LOGO_EDGE / Math.max(image.width, image.height), 4);
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return whitenIfDark(canvas);
  } catch {
    return undefined;
  }
}

function isRaster(bytes: Buffer): boolean {
  const png = bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG";
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return png || jpeg || webp;
}

// An SVG ready to draw at LOGO_EDGE: with its namespace, a size from its viewBox, and white wherever it was drawn in the
// page's text color or in no color at all, the way a logo shows on a dark video.
function sizedSvg(svg: string): string {
  let text = svg.trim().replace(/currentColor/gi, "#ffffff");
  if (!/xmlns=/.test(text)) text = text.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const box = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (box && Number(box[1]) > 0 && Number(box[2]) > 0) {
    const scale = LOGO_EDGE / Math.max(Number(box[1]), Number(box[2]));
    text = text.replace(/<svg\b[^>]*>/i, (tag) =>
      tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/<svg\b/i, `<svg width="${Math.round(Number(box[1]) * scale)}" height="${Math.round(Number(box[2]) * scale)}"`),
    );
  }
  const colored = /(?:fill|stroke)\s*(?:=\s*["']|:\s*)(?!none|inherit|transparent|url)[#a-z]/i.test(text);
  return colored ? text : text.replace(/<svg\b/i, '<svg fill="#ffffff"');
}

// A dark logo on a transparent background would vanish on the dark video, so it's drawn white instead, the way brands
// show their logo on dark. One with no transparency, like a JPEG, sits on its own background and is left alone. A canvas
// with almost nothing drawn on it is nothing.
function whitenIfDark(canvas: Canvas): Canvas | undefined {
  const ctx = canvas.getContext("2d");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  let solid = 0;
  let clear = 0;
  let light = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) clear++;
    if (data[i + 3] > 128) {
      solid++;
      light += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
  }
  const total = data.length / 4;
  if (solid < total * 0.003) return undefined;
  if (clear < total * 0.05 || light / solid > 0.22) return canvas;
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

// A logo on the dark of the video's end card, the way Grok is shown it to judge.
function onDark(logo: Canvas): Canvas {
  const canvas = createCanvas(512, 288);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1b1a22";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width - 48) / logo.width, (canvas.height - 48) / logo.height);
  ctx.drawImage(logo, (canvas.width - logo.width * scale) / 2, (canvas.height - logo.height * scale) / 2, logo.width * scale, logo.height * scale);
  return canvas;
}

function attrOf(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
