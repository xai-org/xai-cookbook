// The look of the words on screen. Each segment takes the next of the theme's `colors`, for the word being said in its
// captions, so the colors change from segment to segment and still look like one video. `text` is the color of the other words in the captions, and `font` is for the big words: the hook,
// the captions, and the stamp. Each font list names a font on macOS first, then ones like it on Windows and Linux.
// With `glow`, the colors glow. `style` is how each thing on screen is drawn and moves, so two themes look different in
// more than their colors, and `graphic` is how its motion graphics look.
export type Theme = { name: string; summary: string; colors: string[]; text: string; font: string; glow?: boolean; style: Style; graphic: Graphic };

// How a theme's motion graphics look, so they belong to the video around them, the way an editor styles a video's
// graphics alike: big type on a plain ground like a keynote, drawn by hand on paper or a chalkboard, set like a
// newspaper's charts, or lit like neon signs. `ground` is what they're drawn on, `ink` the words and lines, `muted` the
// smaller words, and `accents` the colors items take in turn, dark enough to read on a light ground. A look with
// lettering of its own, like handwriting, has its `font`.
export type Graphic = { look: "keynote" | "sketch" | "editorial" | "neon"; ground: string; ink: string; muted: string; accents: string[]; font?: string };

// Handwriting that comes with the app, in FONT_FILES, since few computers have one that reads well.
const HANDWRITING = `Kalam, "Comic Sans MS", "DejaVu Sans"`;

// How a theme draws what's on screen:
// - caption: the word being said pops bigger in color, sits in a colored box, gets a bar under it, fills the words in
//   color as they're said like karaoke, or shows alone, one word at a time.
// - hook: the word being said turns the color, gets a highlighter stroke behind it, or a box.
// - stamp: the ending is a tilted stamp, a badge, a banner across the screen, or huge outlined words.
// - motion: cards slide in, pop in, or drop in.
export type Style = {
  caption: "pop" | "box" | "underline" | "karaoke" | "single";
  hook: "color" | "marker" | "box";
  stamp: "stamp" | "badge" | "banner" | "outline";
  motion: "slide" | "pop" | "drop";
};

export const THEMES = {
  classic: {
    name: "Classic",
    summary: "Yellow and white in heavy letters, with the word being said popping out, like most captions on TikTok.",
    colors: ["#ffdd00"],
    text: "#ffffff",
    font: `"Arial Black", Impact, "DejaVu Sans", Arial`,
    style: { caption: "pop", hook: "color", stamp: "stamp", motion: "slide" },
    graphic: { look: "keynote", ground: "#0b0b0b", ink: "#ffffff", muted: "#8f8f8f", accents: ["#ffdd00"] },
  },
  pop: {
    name: "Candy pop",
    summary: "Hot pink, aqua, and lime in round letters, with each word boxed as it's said, loud and playful.",
    colors: ["#ff4fa3", "#3ee6ff", "#b8ff3d"],
    text: "#ffffff",
    font: `"Arial Rounded MT Bold", "Arial Black", "DejaVu Sans", Arial`,
    style: { caption: "box", hook: "box", stamp: "badge", motion: "pop" },
    graphic: { look: "sketch", ground: "#fffaf0", ink: "#1d1d1f", muted: "#6a6a6a", accents: ["#e8177f", "#0a95b8", "#3f8f00"], font: HANDWRITING },
  },
  sunset: {
    name: "Sunset",
    summary: "Orange, coral, and gold, with words filling in like karaoke and a banner to end on, warm and upbeat.",
    colors: ["#ff8a1f", "#ff6b81", "#ffc93c"],
    text: "#ffffff",
    font: `"Avenir Next", "Segoe UI", "DejaVu Sans", Arial`,
    style: { caption: "karaoke", hook: "marker", stamp: "banner", motion: "slide" },
    graphic: { look: "keynote", ground: "#fff3e6", ink: "#2a1405", muted: "#8a6a55", accents: ["#e2600a", "#d93a57", "#b07c00"] },
  },
  ocean: {
    name: "Ocean",
    summary: "Aqua, sky blue, and mint, with a bar under the word being said, calm and clear.",
    colors: ["#34e0d0", "#6cc8ff", "#9cf7c4"],
    text: "#ffffff",
    font: `"Trebuchet MS", "DejaVu Sans", Arial`,
    style: { caption: "underline", hook: "color", stamp: "outline", motion: "drop" },
    graphic: { look: "keynote", ground: "#f1f7f7", ink: "#0d2b30", muted: "#5b787c", accents: ["#078f84", "#2470c2", "#1b8455"] },
  },
  neon: {
    name: "Neon",
    summary: "Glowing magenta, violet, and cyan in narrow letters, outlined like signs, like a city at night.",
    colors: ["#ff3fd8", "#b18cff", "#2ff3ff"],
    text: "#ffffff",
    font: `"Avenir Next Condensed", "Arial Narrow", Impact, "DejaVu Sans Condensed"`,
    glow: true,
    style: { caption: "pop", hook: "color", stamp: "outline", motion: "pop" },
    graphic: { look: "neon", ground: "#08070d", ink: "#ffffff", muted: "#a49dc2", accents: ["#ff3fd8", "#b18cff", "#2ff3ff"] },
  },
  news: {
    name: "Breaking news",
    summary: "Red in tall, narrow letters, with boxed captions and a banner across the screen, like a news ticker.",
    colors: ["#ff3b30", "#f2f2f2"],
    text: "#ffffff",
    font: `"DIN Condensed", Bahnschrift, Impact, "DejaVu Sans Condensed"`,
    style: { caption: "box", hook: "box", stamp: "banner", motion: "slide" },
    graphic: { look: "editorial", ground: "#ffffff", ink: "#111111", muted: "#5f5f5f", accents: ["#d70d00", "#111111"] },
  },
  mono: {
    name: "Clean mono",
    summary: "White and gray, minimal and calm, with one word on screen at a time.",
    colors: ["#ffffff", "#c9c9c9"],
    text: "#b4b4b4",
    font: `"DIN Alternate", Bahnschrift, "Segoe UI", "DejaVu Sans"`,
    style: { caption: "single", hook: "color", stamp: "outline", motion: "drop" },
    graphic: { look: "keynote", ground: "#0d0d0d", ink: "#ffffff", muted: "#7c7c7c", accents: ["#ffffff", "#bdbdbd"] },
  },
  chalk: {
    name: "Chalkboard",
    summary: "Chalk yellow, pink, and blue in marker letters, with words filling in as they're said, like a classroom.",
    colors: ["#ffe066", "#ff9ebd", "#8fd0ff"],
    text: "#ffffff",
    font: `"Marker Felt", "Segoe Print", "Comic Sans MS", "DejaVu Sans"`,
    style: { caption: "karaoke", hook: "marker", stamp: "stamp", motion: "drop" },
    graphic: { look: "sketch", ground: "#22382b", ink: "#f3f0e6", muted: "#b4c2b1", accents: ["#ffe066", "#ff9ebd", "#8fd0ff"], font: HANDWRITING },
  },
  field: {
    name: "Field notes",
    summary: "Leaf green, sand, and sky in serif letters, underlined like notes in a journal, like a nature documentary.",
    colors: ["#9be15d", "#f0c674", "#8fd3e0"],
    text: "#ffffff",
    font: `Georgia, "DejaVu Serif", serif`,
    style: { caption: "underline", hook: "marker", stamp: "badge", motion: "slide" },
    graphic: { look: "editorial", ground: "#f2eee1", ink: "#1f2a1c", muted: "#686c5b", accents: ["#43801b", "#9c6c14", "#24707e"] },
  },
  files: {
    name: "Case file",
    summary: "Manila and stamp red in typewriter letters, with a rubber stamp to end on, like a secret file.",
    colors: ["#f2d17c", "#ff5a4e"],
    text: "#ffffff",
    font: `"American Typewriter", "Courier New", "DejaVu Sans Mono"`,
    style: { caption: "box", hook: "box", stamp: "stamp", motion: "drop" },
    graphic: { look: "editorial", ground: "#ecd9a6", ink: "#2b2116", muted: "#6b5839", accents: ["#b3241a", "#2b2116"] },
  },
} satisfies Record<string, Theme>;
// "brand" is the theme made from the brand kit, which Grok doesn't pick: it's chosen by hand.
export type ThemeId = keyof typeof THEMES | "brand";
export const THEME_IDS = Object.keys(THEMES) as Array<keyof typeof THEMES>;

// Near black or white, whichever stands out more on `color`, a hex color, by the contrast ratio of the web's
// accessibility guidelines.
export function inkOn(color: string): string {
  const luminance = luminanceOf(color) + 0.05;
  return luminance / 0.0556 >= 1.05 / luminance ? "#111" : "#fff";
}

// `color` mixed toward black on a light `ground`, or white on a dark one, until it stands out from it at least as much
// as the web's accessibility guidelines ask of large text, a contrast ratio of 3.
export function readableOn(color: string, ground: string): string {
  const toward = luminanceOf(ground) > 0.4 ? 0 : 255;
  const contrast = (each: string) => {
    const [a, b] = [luminanceOf(each), luminanceOf(ground)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  let mixed = color;
  for (let step = 1; step <= 10 && contrast(mixed) < 3; step++) {
    mixed = `#${[1, 3, 5].map((at) => Math.round(parseInt(color.slice(at, at + 2), 16) * (1 - step / 10) + toward * (step / 10)).toString(16).padStart(2, "0")).join("")}`;
  }
  return mixed;
}

// How light `color`, a hex color, looks, from 0 for black to 1 for white.
export function luminanceOf(color: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A theme for a video Grok didn't pick one for: one the recent videos in `avoid` didn't use, so videos don't all end up
// looking the same. `seed` picks the same one every time for the same video.
export function freshTheme(avoid: string[] = [], seed = String(Math.random())): keyof typeof THEMES {
  const unused = THEME_IDS.filter((id) => !avoid.includes(id) && id !== "classic");
  const choices = unused.length ? unused : THEME_IDS.filter((id) => id !== "classic");
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return choices[hash % choices.length];
}
