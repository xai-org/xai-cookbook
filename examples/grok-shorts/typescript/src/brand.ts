import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { THEMES, THEME_IDS, type Theme, type ThemeId } from "./themes.ts";

// A creator's brand kit, put on every video they make: their name, up to three colors and a font for the words and
// stickers on screen, drawn the way one of the built-in themes draws them, its `look`, their logo in a corner of every
// frame, an end card with a call to action after the last line, and the presenter new videos start with, in their own
// personality.
// It's saved in output/brand/, with the logo next to it.
export type Brand = {
  name: string;
  colors: string[];
  text: string;
  font: string;
  glow: boolean;
  look?: keyof typeof THEMES;
  logo?: string;
  watermark: boolean;
  endCard: { on: boolean; line: string };
  presenter?: string;
};

// The fonts a brand can use, the same ones the themes use, each naming a font on macOS first and ones like it on Windows
// and Linux after, with how it feels, for Grok to match a website's type to. Inter comes with the app, in FONT_FILES.
export const FONTS = [
  { id: "heavy", name: "Heavy", feel: "very bold and chunky, like Arial Black", stack: `"Arial Black", Impact, "DejaVu Sans", Arial` },
  { id: "rounded", name: "Rounded", feel: "bold with rounded ends, like Arial Rounded", stack: `"Arial Rounded MT Bold", "Arial Black", "DejaVu Sans", Arial` },
  { id: "modern", name: "Modern", feel: "geometric and round, like Avenir or Futura", stack: `"Avenir Next", "Segoe UI", "DejaVu Sans", Arial` },
  { id: "inter", name: "Inter", feel: "neutral and modern, like Inter, Geist, Söhne, or Helvetica, the type of most tech companies", stack: `Inter, "Helvetica Neue", "Segoe UI", "DejaVu Sans", Arial` },
  { id: "friendly", name: "Friendly", feel: "humanist and soft, like Trebuchet", stack: `"Trebuchet MS", "DejaVu Sans", Arial` },
  { id: "narrow", name: "Narrow", feel: "condensed, like Avenir Condensed", stack: `"Avenir Next Condensed", "Arial Narrow", Impact, "DejaVu Sans Condensed"` },
  { id: "tall", name: "Tall", feel: "tall and condensed, like DIN Condensed", stack: `"DIN Condensed", Bahnschrift, Impact, "DejaVu Sans Condensed"` },
  { id: "clean", name: "Clean", feel: "technical and squared, like DIN", stack: `"DIN Alternate", Bahnschrift, "Segoe UI", "DejaVu Sans"` },
  { id: "marker", name: "Marker", feel: "handwritten with a marker", stack: `"Marker Felt", "Segoe Print", "Comic Sans MS", "DejaVu Sans"` },
  { id: "serif", name: "Serif", feel: "a classic serif, like Georgia", stack: `Georgia, "DejaVu Serif", serif` },
  { id: "typewriter", name: "Typewriter", feel: "a typewriter, like Courier", stack: `"American Typewriter", "Courier New", "DejaVu Sans Mono"` },
];

// Fonts that come with the app, since most computers don't have them, in the weights the video draws words in.
export const FONT_FILES = [
  { family: "Inter", weight: 800, file: "fonts/Inter-ExtraBold.ttf" },
  { family: "Inter", weight: 900, file: "fonts/Inter-Black.ttf" },
];

// How long the end card stays on screen after the last line, in seconds.
export const END_CARD_SECONDS = 2.5;

const DIR = "output/brand";
const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function loadBrand(): Promise<Brand | undefined> {
  if (!existsSync(`${DIR}/brand.json`)) return undefined;
  const brand: Brand = JSON.parse(await readFile(`${DIR}/brand.json`, "utf8"));
  return { ...brand, logo: brand.logo && existsSync(brand.logo) ? brand.logo : undefined };
}

// Saves the brand kit from what the Brand Kit page sent, keeping only what makes sense: real colors, a font from the
// list, and a call to action short enough to fit on the end card.
export async function saveBrand(sent: Partial<Brand>): Promise<Brand> {
  const saved = await loadBrand();
  const hex = (color: unknown) => (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined);
  const colors = (Array.isArray(sent.colors) ? sent.colors : []).map(hex).filter((color): color is string => Boolean(color)).slice(0, 3);
  if (!colors.length) throw new Error("Pick at least one color.");
  const brand: Brand = {
    name: String(sent.name ?? "").trim().slice(0, 40),
    colors,
    text: hex(sent.text) ?? "#ffffff",
    font: FONTS.some((font) => font.id === sent.font) ? String(sent.font) : "heavy",
    glow: Boolean(sent.glow),
    look: THEME_IDS.includes(sent.look as keyof typeof THEMES) ? sent.look : "pop",
    logo: saved?.logo,
    watermark: Boolean(sent.watermark),
    endCard: { on: Boolean(sent.endCard?.on), line: String(sent.endCard?.line ?? "").trim().slice(0, 60) },
    presenter: sent.presenter ? String(sent.presenter) : undefined,
  };
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}/brand.json`, JSON.stringify(brand, null, 2));
  return brand;
}

// Saves the logo, a PNG, JPEG, or WebP up to 5 MB, in place of any logo before it.
export async function saveLogo(image: Buffer, type: string): Promise<Brand> {
  const extension = LOGO_TYPES[type.split(";")[0].trim()];
  if (!extension) throw new Error("The logo has to be a PNG, JPEG, or WebP image.");
  if (image.length > 5 * 1024 * 1024) throw new Error("The logo has to be smaller than 5 MB.");
  const brand = (await loadBrand()) ?? (await saveBrand({ colors: THEMES.classic.colors }));
  if (brand.logo) await rm(brand.logo, { force: true });
  await mkdir(DIR, { recursive: true });
  const logo = `${DIR}/logo-${Date.now()}.${extension}`;
  await writeFile(logo, image);
  const kept = { ...brand, logo };
  await writeFile(`${DIR}/brand.json`, JSON.stringify(kept, null, 2));
  return kept;
}

export async function removeLogo(): Promise<Brand | undefined> {
  const brand = await loadBrand();
  if (!brand?.logo) return brand;
  await rm(brand.logo, { force: true });
  const kept = { ...brand, logo: undefined };
  await writeFile(`${DIR}/brand.json`, JSON.stringify(kept, null, 2));
  return kept;
}

// The brand as a theme, for the words and stickers on screen.
export function brandTheme(brand: Brand): Theme {
  const font = FONTS.find((each) => each.id === brand.font) ?? FONTS[0];
  const { style } = THEMES[brand.look ?? "pop"];
  return { name: brand.name || "Your brand", summary: "Your colors and font, from your brand kit.", colors: brand.colors, text: brand.text, font: font.stack, glow: brand.glow, style };
}

// The theme a video is made in: one of the built-in themes, or the brand kit's, if there is one.
export function themeFor(id: ThemeId, brand?: Brand): Theme {
  if (id === "brand") return brand ? brandTheme(brand) : THEMES.classic;
  return THEMES[id] ?? THEMES.classic;
}
