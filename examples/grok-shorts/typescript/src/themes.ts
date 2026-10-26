// The look of the words on screen. Each segment takes the next of the theme's `colors`, for the word being said in its
// captions, so the colors change from segment to segment and still look like one video. `text` is the color of the other words in the captions, and `font` is for the big words: the hook,
// the captions, and the stamp. Each font list names a font on macOS first, then ones like it on Windows and Linux.
// With `glow`, the colors glow. `style` is how each thing on screen is drawn and moves, so two themes look different in
// more than their colors.
export type Theme = { name: string; summary: string; colors: string[]; text: string; font: string; glow?: boolean; style: Style };

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
  },
  pop: {
    name: "Candy pop",
    summary: "Hot pink, aqua, and lime in round letters, with each word boxed as it's said, loud and playful.",
    colors: ["#ff4fa3", "#3ee6ff", "#b8ff3d"],
    text: "#ffffff",
    font: `"Arial Rounded MT Bold", "Arial Black", "DejaVu Sans", Arial`,
    style: { caption: "box", hook: "box", stamp: "badge", motion: "pop" },
  },
  sunset: {
    name: "Sunset",
    summary: "Orange, coral, and gold, with words filling in like karaoke and a banner to end on, warm and upbeat.",
    colors: ["#ff8a1f", "#ff6b81", "#ffc93c"],
    text: "#ffffff",
    font: `"Avenir Next", "Segoe UI", "DejaVu Sans", Arial`,
    style: { caption: "karaoke", hook: "marker", stamp: "banner", motion: "slide" },
  },
  ocean: {
    name: "Ocean",
    summary: "Aqua, sky blue, and mint, with a bar under the word being said, calm and clear.",
    colors: ["#34e0d0", "#6cc8ff", "#9cf7c4"],
    text: "#ffffff",
    font: `"Trebuchet MS", "DejaVu Sans", Arial`,
    style: { caption: "underline", hook: "color", stamp: "outline", motion: "drop" },
  },
  neon: {
    name: "Neon",
    summary: "Glowing magenta, violet, and cyan in narrow letters, outlined like signs, like a city at night.",
    colors: ["#ff3fd8", "#b18cff", "#2ff3ff"],
    text: "#ffffff",
    font: `"Avenir Next Condensed", "Arial Narrow", Impact, "DejaVu Sans Condensed"`,
    glow: true,
    style: { caption: "pop", hook: "color", stamp: "outline", motion: "pop" },
  },
  news: {
    name: "Breaking news",
    summary: "Red in tall, narrow letters, with boxed captions and a banner across the screen, like a news ticker.",
    colors: ["#ff3b30", "#f2f2f2"],
    text: "#ffffff",
    font: `"DIN Condensed", Bahnschrift, Impact, "DejaVu Sans Condensed"`,
    style: { caption: "box", hook: "box", stamp: "banner", motion: "slide" },
  },
  mono: {
    name: "Clean mono",
    summary: "White and gray, minimal and calm, with one word on screen at a time.",
    colors: ["#ffffff", "#c9c9c9"],
    text: "#b4b4b4",
    font: `"DIN Alternate", Bahnschrift, "Segoe UI", "DejaVu Sans"`,
    style: { caption: "single", hook: "color", stamp: "outline", motion: "drop" },
  },
  chalk: {
    name: "Chalkboard",
    summary: "Chalk yellow, pink, and blue in marker letters, with words filling in as they're said, like a classroom.",
    colors: ["#ffe066", "#ff9ebd", "#8fd0ff"],
    text: "#ffffff",
    font: `"Marker Felt", "Segoe Print", "Comic Sans MS", "DejaVu Sans"`,
    style: { caption: "karaoke", hook: "marker", stamp: "stamp", motion: "drop" },
  },
  field: {
    name: "Field notes",
    summary: "Leaf green, sand, and sky in serif letters, underlined like notes in a journal, like a nature documentary.",
    colors: ["#9be15d", "#f0c674", "#8fd3e0"],
    text: "#ffffff",
    font: `Georgia, "DejaVu Serif", serif`,
    style: { caption: "underline", hook: "marker", stamp: "badge", motion: "slide" },
  },
  files: {
    name: "Case file",
    summary: "Manila and stamp red in typewriter letters, with a rubber stamp to end on, like a secret file.",
    colors: ["#f2d17c", "#ff5a4e"],
    text: "#ffffff",
    font: `"American Typewriter", "Courier New", "DejaVu Sans Mono"`,
    style: { caption: "box", hook: "box", stamp: "stamp", motion: "drop" },
  },
} satisfies Record<string, Theme>;
// "brand" is the theme made from the brand kit, which Grok doesn't pick: it's chosen by hand.
export type ThemeId = keyof typeof THEMES | "brand";
export const THEME_IDS = Object.keys(THEMES) as Array<keyof typeof THEMES>;

// Near black or white, whichever stands out more on `color`, a hex color, by the contrast ratio of the web's
// accessibility guidelines.
export function inkOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05;
  return luminance / 0.0556 >= 1.05 / luminance ? "#111" : "#fff";
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
