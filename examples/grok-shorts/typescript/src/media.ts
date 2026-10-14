import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI({ maxRetries: 5 });
const run = promisify(execFile);
// Chrome takes the screenshots, in headless mode, from wherever it's installed.
const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "google-chrome",
  "chromium",
  "chromium-browser",
];
// Each screenshot runs in its own throwaway profile: with the default one, headless Chrome shares the profile of a Chrome
// that's already open, and handed its work over or hung. The page gets six seconds of its own time to run its scripts, and
// the screenshot is taken 15 seconds in at the latest, since a page that never stops working in the background, like
// docs.x.ai, never runs out of things to wait for.
const HEADLESS = [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
  "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--virtual-time-budget=6000", "--timeout=15000",
];
// Some sites, like x.ai, turn away a browser that says it's headless, so reading a brand off one goes as an ordinary Chrome.
const ORDINARY = "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const NO_TEXT = "No words, letters, captions, or logos anywhere.";

// Draws a picture for a beat, in the shape of the space it fills: about the shape of the card above the presenter, or the
// whole screen. Image models garble lettering, so the pictures have none.
export async function drawPicture(prompt: string, aspect: "4:3" | "9:16", file: string, signal?: AbortSignal): Promise<{ file: string; cost: number }> {
  const response = await client.images.generate(
    { model: "grok-imagine-image-2.0", prompt: `${prompt} ${NO_TEXT}`, aspect_ratio: aspect, response_format: "b64_json" },
    { signal },
  );
  const image = response.data[0]?.b64_json;
  if (!image) throw new Error("Grok Imagine didn't draw the picture for a beat.");
  await writeFile(file, Buffer.from(image, "base64"));
  return { file, cost: response.usage?.cost_usd ?? 0 };
}

// Films a short clip from a prompt with Grok Imagine, for a beat with nothing real to show. Without a picture to start
// from, the video model films whatever the prompt describes.
export async function filmBroll(prompt: string, seconds: number, aspect: "4:3" | "9:16", file: string, signal?: AbortSignal): Promise<{ file: string; cost: number }> {
  const { request_id } = await client.videos.generate(
    { model: "grok-imagine-video-1.5", prompt: `${prompt} ${NO_TEXT}`, duration: seconds, aspect_ratio: aspect, resolution: "720p" },
    { signal },
  );
  const result = await client.videos.wait(request_id, { signal });
  if (!result.video?.url) throw new Error("Grok Imagine didn't film the clip.");
  await download(result.video.url, file, signal);
  return { file, cost: result.usage?.cost_usd ?? 0 };
}

// A screenshot of a web page, 1080 pixels wide and tall enough to scroll through while it's on screen. Docs sites often
// serve a page's Markdown at the same address with .md on the end, for agents to read, and the page itself is what's
// worth showing.
export async function screenshotPage(url: string, file: string, signal?: AbortSignal): Promise<string> {
  await screenshot(url.replace(/\.md(?=$|[?#])/, ""), file, "1080,2400", [], signal);
  if (!existsSync(file)) throw new Error(`Chrome couldn't take a screenshot of ${url}.`);
  if (await looksBlank(file)) throw new Error(`${sourceLabel(url)} came out blank in the screenshot.`);
  return file;
}

// The top of a website the way it looks on a laptop, where its logo, colors, and type are, to read its brand from.
export async function screenshotSite(url: string, file: string, signal?: AbortSignal): Promise<string> {
  await screenshot(url, file, "1440,1000", [ORDINARY], signal);
  if (!existsSync(file)) throw new Error(`Chrome couldn't take a screenshot of ${url}.`);
  if (await looksBlank(file)) throw new Error(`${sourceLabel(url)} came out blank in the screenshot.`);
  return file;
}

// A website's HTML after its scripts have run, the way an ordinary Chrome gets it, with the logos that scripts draw.
export async function renderedHtml(url: string, signal?: AbortSignal): Promise<string> {
  const profile = await mkdtemp(join(tmpdir(), "chrome-"));
  try {
    const { stdout } = await run(await findChrome(), [...HEADLESS, `--user-data-dir=${profile}`, ORDINARY, "--dump-dom", url], { signal, timeout: 45_000, maxBuffer: 1 << 26 });
    return stdout;
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

// An X post, the way X's own embed draws it, without signing in, cropped to the post.
export async function screenshotPost(url: string, file: string, signal?: AbortSignal): Promise<string> {
  const id = url.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) throw new Error(`${url} isn't a link to an X post.`);
  await screenshot(`https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true`, file, "550,1400", ["--force-device-scale-factor=2"], signal);
  if (!existsSync(file)) throw new Error(`Chrome couldn't take a screenshot of ${url}.`);
  // In headless Chrome, X's embed sometimes draws nothing at all, which crops down to a sliver.
  if ((await cropToContent(file)) < 120) throw new Error(`X's embed didn't draw ${sourceLabel(url)}'s post.`);
  return file;
}

// Chrome writes the screenshot, then sometimes lingers until it's stopped, so a screenshot that's there counts however
// Chrome ended. It's given the full path, since a fresh profile doesn't start in this folder.
async function screenshot(url: string, file: string, size: string, flags: string[], signal?: AbortSignal): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), "chrome-"));
  try {
    await run(await findChrome(), [...HEADLESS, `--user-data-dir=${profile}`, `--window-size=${size}`, ...flags, `--screenshot=${resolve(file)}`, url], { signal, timeout: 45_000 }).catch((error) => {
      if (!existsSync(file)) throw error;
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

// A few seconds of a video on X, YouTube, or any other site yt-dlp knows, from `start`. Only that part is downloaded.
export async function downloadClip(url: string, start: number, seconds: number, base: string, signal?: AbortSignal): Promise<string> {
  await run(
    "yt-dlp",
    [
      "--quiet", "--no-warnings", "--no-playlist",
      "--format", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
      "--download-sections", `*${start}-${start + seconds}`, "--force-keyframes-at-cuts",
      "--merge-output-format", "mp4", "--output", `${base}.%(ext)s`, url,
    ],
    { signal, timeout: 180_000 },
  ).catch((error: NodeJS.ErrnoException) => {
    throw new Error(error.code === "ENOENT" ? "Showing clips from X and YouTube needs yt-dlp. Install it from https://github.com/yt-dlp/yt-dlp." : `yt-dlp couldn't get ${url}.`);
  });
  if (!existsSync(`${base}.mp4`)) throw new Error(`yt-dlp couldn't get ${url} as an MP4.`);
  return `${base}.mp4`;
}

// The width and height of a video, from ffprobe.
export async function videoSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

// Where something real on screen came from, to credit it: the account for an X post, or the site's name.
export function sourceLabel(url: string): string {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^(www|m|mobile)\./, "");
  const handle = pathname.match(/^\/(\w{1,15})\/status/)?.[1];
  return (host === "x.com" || host === "twitter.com") && handle && handle !== "i" ? `x.com/@${handle}` : host;
}

async function findChrome(): Promise<string> {
  for (const chrome of CHROMES) {
    if (chrome.includes("/") || chrome.includes("\\") ? existsSync(chrome) : await run(chrome, ["--version"]).then(() => true, () => false)) return chrome;
  }
  throw new Error("Screenshots of pages and posts need Google Chrome or Chromium installed.");
}

// A page that drew nothing at all is all the color of its top left corner. Sparse pages, like docs with thin text on white,
// were 89 to 91% that color, as much as a page still loading, so only a page that's 98% one color counts as blank.
async function looksBlank(file: string): Promise<boolean> {
  const image = await loadImage(await readFile(file));
  const canvas = createCanvas(48, 96);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, image.width, Math.min(image.height, image.width * 2), 0, 0, 48, 96);
  const { data } = ctx.getImageData(0, 0, 48, 96);
  let near = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (Math.abs(data[index] - data[0]) + Math.abs(data[index + 1] - data[1]) + Math.abs(data[index + 2] - data[2]) < 50) near++;
  }
  return near / (48 * 96) > 0.98;
}

// The embed draws the post at the top of the window, so everything below it, the same color as the bottom corner, goes.
// Returns the height that's left.
async function cropToContent(file: string): Promise<number> {
  const image = await loadImage(await readFile(file));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const at = (x: number, y: number) => (y * image.width + x) * 4;
  const corner = at(0, image.height - 1);
  const differs = (index: number) => Math.abs(data[index] - data[corner]) + Math.abs(data[index + 1] - data[corner + 1]) + Math.abs(data[index + 2] - data[corner + 2]) > 30;
  const filled = (y: number) => {
    for (let x = 0; x < image.width; x += 4) if (differs(at(x, y))) return true;
    return false;
  };
  let bottom = image.height - 1;
  while (bottom > 0 && !filled(bottom)) bottom--;
  const height = Math.min(image.height, bottom + 24);
  const cropped = createCanvas(image.width, height);
  cropped.getContext("2d").drawImage(image, 0, 0);
  await writeFile(file, await cropped.encode("png"));
  return height;
}

async function download(url: string, file: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}
