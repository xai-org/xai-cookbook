import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

// Something the creator uploaded to use in any of their videos: an image or a video to show on a segment, or music to
// play under one. Uploads are saved in output/library/, with the list of them in library.json.
export type Asset = { id: string; name: string; kind: "image" | "video" | "audio"; file: string; size: number; added: number; width?: number; height?: number; duration?: number };

const DIR = "output/library";
const LIMIT = 300 * 1024 * 1024;
const TYPES: Record<string, { kind: Asset["kind"]; extension: string }> = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/quicktime": { kind: "video", extension: "mov" },
  "video/webm": { kind: "video", extension: "webm" },
  "audio/mpeg": { kind: "audio", extension: "mp3" },
  "audio/mp4": { kind: "audio", extension: "m4a" },
  "audio/x-m4a": { kind: "audio", extension: "m4a" },
  "audio/wav": { kind: "audio", extension: "wav" },
  "audio/x-wav": { kind: "audio", extension: "wav" },
};

export async function listAssets(): Promise<Asset[]> {
  if (!existsSync(`${DIR}/library.json`)) return [];
  const assets: Asset[] = JSON.parse(await readFile(`${DIR}/library.json`, "utf8"));
  return assets.filter((asset) => existsSync(asset.file));
}

export async function findAsset(id: string): Promise<Asset | undefined> {
  return (await listAssets()).find((asset) => asset.id === id);
}

// Saves an upload streamed from the page, up to 300 MB, and measures it: an image's size, or a video's or song's length
// too. A file that isn't really what its type says is thrown away.
export async function addAsset(req: IncomingMessage, name: string, type: string): Promise<Asset> {
  const known = TYPES[type.split(";")[0].trim()];
  if (!known) throw new Error("Upload a PNG, JPEG, or WebP image, an MP4, MOV, or WebM video, or MP3, M4A, or WAV audio.");
  if (Number(req.headers["content-length"] ?? 0) > LIMIT) throw new Error("That file is too big. It has to be smaller than 300 MB.");
  await mkdir(DIR, { recursive: true });
  const id = `upload-${randomBytes(4).toString("hex")}`;
  const file = `${DIR}/${id}.${known.extension}`;
  await pipeline(req, createWriteStream(file));
  const measured = await measure(file, known.kind).catch(async (error) => {
    await rm(file, { force: true });
    throw new Error(`That file couldn't be read, because ${error instanceof Error ? error.message : String(error)}.`);
  });
  const asset: Asset = { id, name: name.trim().slice(0, 80) || id, kind: known.kind, file, size: (await stat(file)).size, added: Date.now(), ...measured };
  await saveList([...(await listAssets()), asset]);
  return asset;
}

export async function removeAsset(id: string): Promise<void> {
  const assets = await listAssets();
  const asset = assets.find((each) => each.id === id);
  if (!asset) return;
  await Promise.all([rm(asset.file, { force: true }), rm(thumbOf(asset), { force: true })]);
  await saveList(assets.filter((each) => each !== asset));
}

// A still of a video, to pick it by, made the first time it's asked for. An image is its own.
export async function thumbnail(asset: Asset): Promise<string | undefined> {
  if (asset.kind === "image") return asset.file;
  if (asset.kind === "audio") return undefined;
  const thumb = thumbOf(asset);
  if (!existsSync(thumb)) await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(1, (asset.duration ?? 0) / 2)), "-i", asset.file, "-frames:v", "1", "-vf", "scale=360:-2", thumb]);
  return thumb;
}

// The uploads Grok can put on a beat, for its instructions: each one's id, name, and shape. Music isn't shown on screen,
// so it isn't listed.
export function assetsBrief(assets: Asset[]): string {
  const shown = assets.filter((asset) => asset.kind !== "audio");
  if (!shown.length) return "";
  const described = shown.map((asset) => {
    const what = asset.kind === "image" ? "an image" : `a ${Math.round(asset.duration ?? 0)}-second video`;
    return `- ${asset.id}: "${asset.name}", ${what}${asset.width ? `, ${asset.width} by ${asset.height}` : ""}`;
  });
  return `The creator's own uploads, which a beat can show as an upload visual, with the upload's id as its url. Use one wherever it shows what the line is about better than anything you found:\n${described.join("\n")}`;
}

async function measure(file: string, kind: Asset["kind"]): Promise<Pick<Asset, "width" | "height" | "duration">> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,codec_type:format=duration", "-of", "json", file]);
  const probed: { streams?: Array<{ codec_type: string; width?: number; height?: number }>; format?: { duration?: string } } = JSON.parse(stdout);
  const picture = probed.streams?.find((stream) => stream.codec_type === "video" && stream.width && stream.height);
  if (kind !== "audio" && !picture) throw new Error("it has no picture");
  if (kind === "audio" && !probed.streams?.some((stream) => stream.codec_type === "audio")) throw new Error("it has no sound");
  return { width: picture?.width, height: picture?.height, duration: kind === "image" ? undefined : Number(probed.format?.duration) || undefined };
}

function thumbOf(asset: Asset): string {
  return asset.file.replace(/\.\w+$/, "-thumb.jpg");
}

async function saveList(assets: Asset[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}/library.json`, JSON.stringify(assets, null, 2));
}
