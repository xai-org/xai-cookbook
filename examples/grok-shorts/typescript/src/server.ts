import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { basename, extname } from "node:path";
import { pipeline } from "node:stream";
import { pipeline as save } from "node:stream/promises";
import { listBatches, startBatch } from "./batches.ts";
import { type Brand, FONTS, FONT_FILES, brandTheme, loadBrand, removeLogo, saveBrand, saveLogo } from "./brand.ts";
import { brandFromWebsite } from "./website.ts";
import { type Asset, addAsset, assetsBrief, findAsset, listAssets, removeAsset, thumbnail } from "./library.ts";
import { inventPersonality, listPersonalities, parseHandle, personaFromX, sampleLines, savePersonality } from "./persona.ts";
import { drawPortraits, drawPresenter, findFace, findPresenter, listPresenters, personalityOf, savePresenter } from "./presenter.ts";
import { type Cut, type Note, type Project, addNote, archiveCurrent, changesSince, cutsOf, filmstrip, keepCut, loadProject, newProject, notesMessage, recentThemes, restoreCut, saveProject } from "./project.ts";
import { reviewCut } from "./review.ts";
import { PRESETS, type Source, listSources, removeSource, saveSource, testSource } from "./sources.ts";
import { DEFAULT_SOUND, type Layout, PLATFORMS, type Platform, type Question, hookOptions, moveSegment, publishText, moveSegmentTo, removeSegment, setLayout, setLine, setSound, setTheme, setTrim, setUpload } from "./script.ts";
import { type Cache, type WriteEvents, chooseTake, estimateDraft, filmDraft, newCache, previewVisuals, retakeSegment, reviseDraft, startDraft, takesOf, transcriptOf } from "./short.ts";
import { cloneVoice, inventPresenter, listVoices, newPresenterId, previewVoice, readVideo } from "./studio.ts";
import { TAKES_PER_LINE, TAKE_USD_PER_SECOND, filmLine, lineSeconds } from "./takes.ts";
import { THEMES, type ThemeId } from "./themes.ts";

const PORT = Number(process.env.PORT ?? 3000);
const PAGES: Record<string, URL> = {
  "/": new URL("../public/index.html", import.meta.url),
  "/studio": new URL("../public/studio.html", import.meta.url),
  "/videos": new URL("../public/videos.html", import.meta.url),
  "/brand": new URL("../public/brand.html", import.meta.url),
  "/library": new URL("../public/library.html", import.meta.url),
  "/apps": new URL("../public/apps.html", import.meta.url),
};
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ttf": "font/ttf",
};
// Every file the server has saved, by path. It serves these files and nothing else, and the studio only takes back
// portraits it handed out.
const files = new Set<string>();
// Each video open in a page: its project, saved in its folder after every change, the takes and pictures made for it
// while the server runs, and whether it's being filmed.
type Session = { project?: Project; cache: Cache; filming: boolean };
const sessions = new Map<string, Session>();
const GONE = "The server restarted since this conversation began. Open the video again from Your Videos.";

// Any request that fails gets an error back, so one bad request never stops the server and the videos it's making.
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    // Personalities are made with their presenters in Presenter Studio now.
    if (url.pathname === "/personalities") return void res.writeHead(302, { location: "/studio" }).end();
    // The Apps page was called Sources, and batches are made from the main page, with Batch.
    if (url.pathname === "/sources") return void res.writeHead(302, { location: "/apps" }).end();
    if (url.pathname === "/batch") return void res.writeHead(302, { location: "/?several" }).end();
    const page = PAGES[url.pathname];
    if (page) return reply(res, 200, "text/html; charset=utf-8", await readFile(page));
    if (url.pathname === "/api/options") return await options(res);
    if (url.pathname === "/api/brand" && req.method === "GET") return await brandKit(res);
    if (url.pathname === "/api/brand" && req.method === "POST") return await keepBrand(await readJson(req), res);
    if (url.pathname === "/api/brand/logo" && req.method === "POST") return await uploadLogo(req, res);
    if (url.pathname === "/api/brand/logo/remove" && req.method === "POST") return await dropLogo(res);
    if (url.pathname === "/api/brand/website" && req.method === "POST") return await brandWebsite(await readJson(req), res);
    if (url.pathname === "/api/batches" && req.method === "GET") return await batches(res);
    if (url.pathname === "/api/batch" && req.method === "POST") return await batch(await readJson(req), res);
    if (url.pathname === "/api/sources" && req.method === "GET") return await sources(res);
    if (url.pathname === "/api/sources" && req.method === "POST") return await keepSource(await readJson(req), res);
    if (url.pathname === "/api/sources/remove" && req.method === "POST") return await dropSource(await readJson(req), res);
    if (url.pathname === "/api/sources/test" && req.method === "POST") return await tryTheSource(await readJson(req), res);
    if (url.pathname === "/api/library" && req.method === "GET") return await library(res);
    if (url.pathname === "/api/library/upload" && req.method === "POST") return await upload(url, req, res);
    if (url.pathname === "/api/library/remove" && req.method === "POST") return await unload(await readJson(req), res);
    if (url.pathname === "/api/upload-visual" && req.method === "POST") return await uploadVisual(await readJson(req), res);
    if (url.pathname === "/api/sound" && req.method === "POST") return await sound(await readJson(req), res);
    if (url.pathname === "/api/videos") return await videos(res);
    if (url.pathname === "/api/chat" && req.method === "POST") return await chat(await readJson(req), res);
    if (url.pathname === "/api/film" && req.method === "POST") return await film(await readJson(req), res);
    if (url.pathname === "/api/visuals" && req.method === "POST") return await visuals(await readJson(req), res);
    if (url.pathname === "/api/layout" && req.method === "POST") return await layout(await readJson(req), res);
    if (url.pathname === "/api/theme" && req.method === "POST") return await theme(await readJson(req), res);
    if (url.pathname === "/api/line" && req.method === "POST") return await line(await readJson(req), res);
    if (url.pathname === "/api/segment" && req.method === "POST") return await segment(await readJson(req), res);
    if (url.pathname === "/api/trim" && req.method === "POST") return await trim(await readJson(req), res);
    if (url.pathname === "/api/estimate" && req.method === "POST") return await estimate(await readJson(req), res);
    if (url.pathname === "/api/changes" && req.method === "POST") return await changes(await readJson(req), res);
    if (url.pathname === "/api/hooks" && req.method === "POST") return await hooks(await readJson(req), res);
    if (url.pathname === "/api/publish" && req.method === "POST") return await publishing(await readJson(req), res);
    if (url.pathname === "/api/takes" && req.method === "POST") return await takes(await readJson(req), res);
    if (url.pathname === "/api/take" && req.method === "POST") return await take(await readJson(req), res);
    if (url.pathname === "/api/retake" && req.method === "POST") return await retake(await readJson(req), res);
    if (url.pathname === "/api/open" && req.method === "POST") return await open(await readJson(req), res);
    if (url.pathname === "/api/cut" && req.method === "POST") return await showVersion(await readJson(req), res);
    if (url.pathname === "/api/restore" && req.method === "POST") return await restoreVersion(await readJson(req), res);
    if (url.pathname === "/api/notes/add" && req.method === "POST") return await notes("add", await readJson(req), res);
    if (url.pathname === "/api/notes/remove" && req.method === "POST") return await notes("remove", await readJson(req), res);
    if (url.pathname === "/api/review" && req.method === "POST") return await review(await readJson(req), res);
    if (url.pathname.startsWith("/api/studio/")) return await studio(url, req, res);
    if (url.pathname.startsWith("/api/personalities/")) return await personalityStudio(url, req, res);
    const path = pathOf(url.pathname);
    if (path) return await sendFile(req, res, path);
    reply(res, 404, "text/plain", "Not found");
  } catch (error) {
    if (!res.headersSent) reply(res, 500, "application/json", JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    else res.end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}, or http://localhost:${PORT}/studio to make a presenter`));

// What a new video can be made with: the presenters, personalities, and themes, with the brand kit's theme first if
// there's one, and the presenter and personality it starts with.
async function options(res: ServerResponse): Promise<void> {
  const personalities = (await listPersonalities()).map(({ id, name, summary, custom }) => ({ id, name, summary, custom }));
  const presenters = await castList();
  const brand = await loadBrand();
  const builtIn = Object.entries(THEMES).map(([id, { name, summary, colors }]) => ({ id, name, summary, colors }));
  const themes = brand ? [{ id: "brand", ...pick(brandTheme(brand), ["name", "summary", "colors"]) }, ...builtIn] : builtIn;
  const defaults = brand && { presenter: brand.presenter };
  const sources = (await listSources()).filter((source) => source.enabled).map(({ id, name }) => ({ id, name }));
  reply(res, 200, "application/json", JSON.stringify({ presenters, personalities, themes, defaults, sources, takesPerLine: TAKES_PER_LINE }));
}

// Every presenter, with their own personality and its name, and their portrait, if they've been drawn.
async function castList() {
  const personalities = await listPersonalities();
  const named = (id: string) => (id.startsWith("@") ? `Like ${id}` : (personalities.find((each) => each.id === id)?.name ?? id));
  return (await listPresenters()).map((presenter) => {
    const personality = personalityOf(presenter);
    const portrait = `output/presenters/${presenter.id}.jpg`;
    return { id: presenter.id, name: presenter.name, voice: presenter.voice, look: presenter.look, room: presenter.room, personality, personalityName: named(personality), portrait: existsSync(portrait) ? serve(portrait) : undefined };
  });
}

function pick<T extends object, K extends keyof T>(object: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, object[key]])) as Pick<T, K>;
}

// The brand kit, for the Brand Kit page: what's saved, and the fonts, presenters, and personalities to choose from, with
// the files of the fonts that come with the app and the portrait of each presenter who has one, to preview the brand in.
async function brandKit(res: ServerResponse): Promise<void> {
  const brand = await loadBrand();
  const looks = Object.entries(THEMES).map(([id, { name, style }]) => ({ id, name, style }));
  const faces = FONT_FILES.map(({ family, weight, file }) => ({ family, weight, url: serve(file) }));
  reply(res, 200, "application/json", JSON.stringify({ brand: brand && shownBrand(brand), fonts: FONTS, faces, looks, presenters: await castList() }));
}

async function keepBrand(sent: Record<string, unknown>, res: ServerResponse): Promise<void> {
  reply(res, 200, "application/json", JSON.stringify({ brand: shownBrand(await saveBrand(sent as Partial<Brand>)) }));
}

async function uploadLogo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const brand = await saveLogo(await readBytes(req, 5 * 1024 * 1024), req.headers["content-type"] ?? "");
  reply(res, 200, "application/json", JSON.stringify({ brand: shownBrand(brand) }));
}

// Reads a brand kit off a website, for the Brand Kit page to fill in. Nothing is saved: the logo comes back as a data URL,
// and Save Brand Kit saves it with the rest.
async function brandWebsite({ url = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { logo, ...suggested } = await brandFromWebsite(url);
  reply(res, 200, "application/json", JSON.stringify({ suggested, logo: logo && `data:image/png;base64,${logo.toString("base64")}` }));
}

async function dropLogo(res: ServerResponse): Promise<void> {
  const brand = await removeLogo();
  reply(res, 200, "application/json", JSON.stringify({ brand: brand && shownBrand(brand) }));
}

function shownBrand(brand: Brand): Brand {
  return { ...brand, logo: brand.logo && serve(brand.logo) };
}

// Every batch, newest first, with each video's preview to watch, if it has one.
async function batches(res: ServerResponse): Promise<void> {
  const listed = (await listBatches()).map((each) => ({
    ...each,
    items: each.items.map((item) => {
      const file = item.folder && item.preview ? `output/${item.folder}/cuts/${item.preview}.mp4` : "";
      return { ...item, preview: file && existsSync(file) ? serve(file) : undefined, theme: item.theme && (THEMES[item.theme as keyof typeof THEMES]?.name ?? item.theme) };
    }),
  }));
  reply(res, 200, "application/json", JSON.stringify({ batches: listed }));
}

// Starts a batch: a script for each line, written in the background, each a video like one made in the chat, kept open
// in a session so a page that opens it works on the same video as the batch.
async function batch(sent: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const lines = String(sent.sources ?? "").split("\n");
  const adopt = (project: Project) => {
    const found = [...sessions.values()].find((session) => session.project?.dir === project.dir);
    if (found) return found;
    const session: Session = { project, cache: newCache(project.choices), filming: false };
    sessions.set(randomUUID(), session);
    return session;
  };
  const presenter = await findPresenter(String(sent.presenter || "maya"));
  const { batch: started } = await startBatch(lines, presenter.id, String(sent.personality || personalityOf(presenter)), Boolean(sent.preview), await recentThemes(), adopt);
  reply(res, 200, "application/json", JSON.stringify({ id: started.id }));
}

// The connected apps, for the Apps page, with servers to start from. Tokens stay on the server: the page only sees
// whether an app has one.
async function sources(res: ServerResponse): Promise<void> {
  const saved = (await listSources()).map(shownSource);
  reply(res, 200, "application/json", JSON.stringify({ sources: saved, presets: PRESETS }));
}

async function keepSource(sent: Record<string, unknown>, res: ServerResponse): Promise<void> {
  reply(res, 200, "application/json", JSON.stringify({ source: shownSource(await saveSource(sent as Partial<Source>)) }));
}

async function dropSource({ id = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  await removeSource(id);
  reply(res, 200, "application/json", JSON.stringify({ removed: id }));
}

// Checks that Grok can reach a source, with the tools it finds there.
async function tryTheSource({ id = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const source = (await listSources()).find((each) => each.id === id);
  if (!source) return reply(res, 400, "application/json", JSON.stringify({ error: "There's no such source." }));
  try {
    reply(res, 200, "application/json", JSON.stringify({ tools: await testSource(source) }));
  } catch (error) {
    reply(res, 200, "application/json", JSON.stringify({ error: `Grok couldn't reach ${source.name}: ${error instanceof Error ? error.message : String(error)}` }));
  }
}

function shownSource({ token, ...source }: Source) {
  return { ...source, token: token ? "saved" : "" };
}

// Everything in the library, newest first, with a still of each video to pick it by.
async function library(res: ServerResponse): Promise<void> {
  const assets = await listAssets();
  const shown = await Promise.all(assets.toReversed().map(shownAsset));
  reply(res, 200, "application/json", JSON.stringify({ assets: shown }));
}

async function upload(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const asset = await addAsset(req, url.searchParams.get("name") ?? "", req.headers["content-type"] ?? "", Number(req.headers["content-length"] ?? 0));
  reply(res, 200, "application/json", JSON.stringify({ asset: await shownAsset(asset) }));
}

async function unload({ id = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  await removeAsset(id);
  reply(res, 200, "application/json", JSON.stringify({ removed: id }));
}

async function shownAsset(asset: Asset) {
  const thumb = await thumbnail(asset).catch(() => undefined);
  return { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, added: asset.added, width: asset.width, height: asset.height, duration: asset.duration, url: serve(asset.file), thumb: thumb && serve(thumb) };
}

// Changes the music and sound effects. They're mixed in after filming, so the next cut costs nothing more for it.
async function sound(sent: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const project = sessions.get(String(sent.session ?? ""))?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const music = typeof sent.music === "string" ? sent.music : undefined;
  if (music && (await findAsset(music))?.kind !== "audio") return reply(res, 400, "application/json", JSON.stringify({ error: "That isn't music in your library." }));
  project.draft = setSound(project.draft, { music, volume: typeof sent.volume === "number" ? sent.volume : undefined, effects: typeof sent.effects === "boolean" ? sent.effects : undefined });
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ sound: project.draft.sound }));
}

// Shows an upload on a segment of the latest script, by hand. Grok hears about it with the next message.
async function uploadVisual({ session: id = "", index = "", asset: assetId = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const asset = await findAsset(assetId);
  if (!asset || asset.kind === "audio") return reply(res, 400, "application/json", JSON.stringify({ error: "That upload isn't an image or a video in your library." }));
  project.draft = setUpload(project.draft, Number(index), asset);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ segment: project.draft.segments[Number(index)] }));
}

// Every video made so far, newest first, from the folders in output/, so they're still there after the server restarts.
// Videos made by earlier versions of the app saved a little less about themselves, like the link as `url`.
async function videos(res: ServerResponse): Promise<void> {
  const presenters = new Map((await listPresenters()).map(({ id, name }) => [id, name]));
  const folders = existsSync("output") ? await readdir("output", { withFileTypes: true }) : [];
  const found = await Promise.all(
    folders.map(async (folder) => {
      const dir = `output/${folder.name}`;
      if (!folder.isDirectory()) return [];
      if (!existsSync(`${dir}/short.mp4`) || !existsSync(`${dir}/script.json`)) return existsSync(`${dir}/project.json`) ? [await draftOf(dir, folder.name, presenters)] : [];
      const saved = JSON.parse(await readFile(`${dir}/script.json`, "utf8"));
      const made = (await stat(`${dir}/short.mp4`)).mtimeMs;
      const presenter = saved.presenter ?? saved.character ?? "";
      return [
        {
          folder: dir,
          // A video made again in the same folder keeps its name, so the browser asks for it by when it was made.
          video: `${serve(`${dir}/short.mp4`)}?made=${Math.round(made)}`,
          title: saved.title ?? folder.name,
          about: saved.about ?? saved.url ?? "",
          presenter: presenters.get(presenter) ?? presenter,
          personality: saved.persona?.name ?? saved.personality ?? "",
          duration: saved.parts?.at(-1)?.end ?? 0,
          segments: saved.parts?.length ?? 0,
          made,
          transcript: existsSync(`${dir}/transcript.md`) ? await readFile(`${dir}/transcript.md`, "utf8") : "",
        },
      ];
    }),
  );
  reply(res, 200, "application/json", JSON.stringify(found.flat().sort((a, b) => b.made - a.made)));
}

// A video written but not filmed yet, like one from a batch, with its latest preview to watch, if it has one.
async function draftOf(dir: string, name: string, presenters: Map<string, string>) {
  const project: Project = JSON.parse(await readFile(`${dir}/project.json`, "utf8"));
  const preview = cutsOf(project).filter((cut) => cut.kind === "preview").at(-1);
  const { source } = project.draft;
  return {
    folder: dir,
    draft: true,
    video: preview && existsSync(preview.video) ? `${serve(preview.video)}?made=${preview.id}` : undefined,
    title: project.draft.title || name,
    about: "pr" in source ? source.pr.url : source.idea,
    presenter: presenters.get(project.presenter) ?? project.presenter,
    personality: project.draft.persona?.name ?? project.draft.personality,
    duration: preview?.parts.at(-1)?.end ?? 0,
    segments: project.draft.segments.length,
    made: (await stat(`${dir}/project.json`)).mtimeMs,
    transcript: project.draft.segments.length ? transcriptOf(project.draft) : "",
  };
}

// One message in a conversation about a video, answered with Grok's script as server-sent events: the note to the person,
// then each segment as soon as it's written. The first message, a link to a pull request or an idea, starts the
// conversation, and the video's project is saved from then on. With `notes`, the notes on the latest cut that Grok
// hasn't had yet go with the message. `personality` is the id of a personality, or an X handle with its @.
async function chat({ session: id = "", message = "", presenter = "", personality = "", notes = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { emit, signal, end } = openEvents(res);
  try {
    if (id && !sessions.has(id)) throw new Error(GONE);
    const sessionId = id || randomUUID();
    const session = sessions.get(sessionId) ?? { cache: newCache(), filming: false };
    const { project } = session;
    // Without a personality picked for this video, it keeps the one it has, or a new video takes the presenter's own.
    personality ||= project ? project.draft.personality : personalityOf(await findPresenter(presenter || "maya"));
    const sending = project && notes ? project.notes.filter((note) => !note.sent) : [];
    if (!message.trim() && !sending.length) throw new Error("Write a message first.");
    sessions.set(sessionId, session);
    emit("session", { id: sessionId });
    let asked: Question[] | undefined;
    const on: WriteEvents = {
      stage: (stage, status) => emit("stage", { stage, status }),
      pullRequest: ({ url, repo, number, title, author, additions, deletions, changedFiles }) => emit("pull", { url, repo, number, title, author, additions, deletions, changedFiles }),
      persona: (persona) => emit("persona", persona),
      reasoning: (text) => emit("reasoning", { text }),
      research: (where, query) => emit("research", { where, query }),
      note: (note) => emit("note", { note }),
      questions: (questions) => {
        asked = questions;
        emit("questions", { questions });
      },
      segment: (segment, index) => emit("segment", { index, ...segment }),
    };
    const { text, pictures } = sending.length ? await notesMessage(sending, message) : { text: message, pictures: [] };
    // Grok hears what's in the library when the video starts, and again whenever it's changed since.
    const uploads = assetsBrief(await listAssets());
    const told = project && uploads && uploads !== project.briefed ? `${text}\n\n${uploads}` : text;
    const written = project ? await reviseDraft(project.draft, told, personality, on, signal, pictures) : await startDraft(message, presenter, personality, on, signal, uploads, await recentThemes());
    // A new video starts in the brand kit's theme, if there's one, which stays until it's changed by hand.
    if (!project && (await loadBrand())) written.draft = { ...written.draft, theme: "brand" };
    const saved = project ?? (await newProject(written.draft, presenter));
    saved.draft = written.draft;
    saved.briefed = uploads;
    saved.history.push({ role: "user", text: message, notes: sending.length ? sending : undefined }, { role: "grok", note: written.note, questions: asked });
    for (const note of sending) note.sent = true;
    session.project = saved;
    await saveProject(saved);
    emit("done", { title: written.draft.title, segments: written.draft.segments, theme: written.draft.theme, sound: { ...DEFAULT_SOUND, ...written.draft.sound }, personality: written.draft.personality, folder: basename(saved.dir) });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: failed("Writing the script", error) });
  }
  end();
}

// Films the conversation's latest script, keeping the takes and pictures of segments that haven't changed since the last
// cut, and streams its progress to the page as server-sent events. A `preview` films nothing and costs a fraction of a
// cent: it's kept as a version to watch, but never becomes the video.
async function film({ session: id = "", presenter = "", preview = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { emit, signal, end } = openEvents(res);
  const session = sessions.get(id);
  const project = session?.project;
  let started = false;
  try {
    if (!session || !project) throw new Error(id ? GONE : "Write a script first, then film it.");
    if (session.filming) throw new Error("This video is already being filmed.");
    session.filming = started = true;
    await archiveCurrent(project);
    const { draft } = project;
    const short = await filmDraft(
      draft,
      presenter,
      session.cache,
      {
        stage: (stage, status) => emit("stage", { stage, status }),
        portrait: (file) => emit("portrait", { url: serve(file) }),
        media: (index, { file, video, source }) => emit("media", { index, url: serve(file), video, source }),
        notice: (message) => emit("notice", { message }),
        take: (index, update) =>
          emit(
            "take",
            update.status === "done"
              ? { index, status: "done", video: serve(update.take.file), heard: update.take.heard, filmed: update.take.filmed, reused: update.reused }
              : { index, status: "filming", percent: update.percent },
          ),
        progress: (frame, frames) => emit("progress", { frame, frames }),
      },
      signal,
      project.dir,
      { preview: Boolean(preview) },
    );
    const cost = short.cost.presenter + short.cost.media + short.cost.takes;
    project.presenter = presenter;
    const made = Date.now();
    const takes = short.takes.map((take) => take.file);
    const cut = await keepCut(project, { id: made, video: short.video, made, parts: short.parts, words: short.words, segments: draft.segments, title: draft.title, theme: draft.theme, sound: draft.sound, cost, takes, ...(preview ? { kind: "preview" as const } : {}) });
    await saveProject(project);
    emit("done", { ...(await cutView(project, cut)), versions: versionsOf(project) });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: failed("Filming", error) });
    else console.log(`${new Date().toLocaleTimeString()} Filming stopped: the page stopped it, or closed.`);
  } finally {
    if (session && started) session.filming = false;
  }
  end();
}

// Gets what the latest script's segments show, before anything is filmed, and streams each one to the page as it's ready.
// Filming later uses the same ones.
async function visuals({ session: id = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { emit, signal, end } = openEvents(res);
  try {
    const session = sessions.get(id);
    const project = session?.project;
    if (!session || !project) throw new Error(GONE);
    const { cost } = await previewVisuals(
      project.draft,
      session.cache,
      {
        stage: (stage, status) => emit("stage", { stage, status }),
        media: (index, { file, video, source }) => emit("media", { index, url: serve(file), video, source }),
        notice: (message) => emit("notice", { message }),
      },
      signal,
      project.dir,
    );
    emit("done", { cost });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: failed("Getting the visuals", error) });
  }
  end();
}

// Changes how one segment of the latest script is framed, by hand. Grok hears about it with the next message.
async function layout({ session: id = "", index = "", layout = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  project.draft = setLayout(project.draft, Number(index), layout as Layout);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ segment: project.draft.segments[Number(index)] }));
}

// Changes the theme of the latest script by hand. Grok hears about it with the next message, and filming again redraws
// the video in it without filming anything new.
async function theme({ session: id = "", theme = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  project.draft = setTheme(project.draft, theme as ThemeId);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ theme: project.draft.theme }));
}

// Changes what a segment of the latest script says, by hand. Grok hears about it with the next message.
async function line({ session: id = "", index = "", line: text = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  project.draft = setLine(project.draft, Number(index), text);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ segment: project.draft.segments[Number(index)] }));
}

// Cuts a segment of the latest script, or moves it up or down, or `to` another place, by hand. Grok hears about it with
// the next message.
async function segment({ session: id = "", index = "", action = "", to = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const at = Number(index);
  if (action === "remove") project.draft = removeSegment(project.draft, at);
  else if (action === "to") project.draft = moveSegmentTo(project.draft, at, Number(to));
  else project.draft = moveSegment(project.draft, at, action === "up" ? -1 : 1);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ segments: project.draft.segments }));
}

// The hook lab: four other hooks for the latest script, with scores, to hear and pick from.
async function hooks({ session: id = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const { current, hooks: options } = await hookOptions(project.draft);
  reply(res, 200, "application/json", JSON.stringify({ current, hooks: options }));
}

// What goes with the video when it's posted on a platform: a title, a description, and hashtags.
async function publishing({ session: id = "", platform = "shorts" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  if (!(platform in PLATFORMS)) return reply(res, 400, "application/json", JSON.stringify({ error: "Pick YouTube Shorts, TikTok, or Reels." }));
  const { title, description, hashtags } = await publishText(project.draft, platform as Platform);
  reply(res, 200, "application/json", JSON.stringify({ title, description, hashtags }));
}

// Trims a segment's take on the timeline. Only how much of the take the cut uses changes, so nothing is filmed again.
async function trim({ session: id = "", index = "", head = "", tail = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  project.draft = setTrim(project.draft, Number(index), Number(head), Number(tail));
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ segment: project.draft.segments[Number(index)] }));
}

// How long each segment of the latest script runs, which ones are filmed already, and about what filming the rest costs.
async function estimate({ session: id = "", presenter = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const session = sessions.get(id);
  const project = session?.project;
  if (!session || !project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  reply(res, 200, "application/json", JSON.stringify(await estimateDraft(project.draft, presenter || project.presenter, session.cache, project.dir)));
}

// What changed in the latest script since the current cut, and how many segments filming again films a new take for, to
// see before filming again or previewing.
async function changes({ session: id = "", presenter = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const session = sessions.get(id);
  const project = session?.project;
  if (!session || !project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  if (!project.cut) return reply(res, 200, "application/json", JSON.stringify({ changes: [], newTakes: 0 }));
  const who = presenter || project.presenter;
  const [{ segments: estimates }, takes] = await Promise.all([estimateDraft(project.draft, who, session.cache, project.dir), takesOf(project.draft, who, session.cache, project.cut.takes, project.dir)]);
  const each = estimates.map(({ filmed }, index) => ({ filmed, chosen: takes[index]?.chosen }));
  const swapped = who !== project.presenter ? { was: (await findPresenter(project.presenter)).name, is: (await findPresenter(who)).name } : undefined;
  reply(res, 200, "application/json", JSON.stringify({ changes: changesSince(project.cut, project.draft, each, swapped), newTakes: estimates.filter(({ filmed }) => !filmed).length }));
}

// Every take saved for each segment of the latest script, to watch and pick from, and the one the next cut uses.
async function takes({ session: id = "", presenter = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const session = sessions.get(id);
  const project = session?.project;
  if (!session || !project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const listed = await takesOf(project.draft, presenter || project.presenter, session.cache, project.cut?.takes, project.dir);
  const shown = listed.map(({ files, chosen }, index) => ({
    takes: files.map((file, letter) => ({ url: serve(file), letter: String.fromCharCode(65 + letter), chosen: file === chosen })),
    retakeCost: lineSeconds(project.draft.segments[index].line) * TAKES_PER_LINE * TAKE_USD_PER_SECOND,
  }));
  reply(res, 200, "application/json", JSON.stringify({ segments: shown }));
}

// Picks one of a segment's takes, by hand, for the next cut. It's saved with the project, so it outlasts the server.
async function take({ session: id = "", presenter = "", index = "", url: picked = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const session = sessions.get(id);
  const project = session?.project;
  if (!session || !project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const file = pathOf(picked);
  if (!file) return reply(res, 400, "application/json", JSON.stringify({ error: "That isn't one of this segment's takes." }));
  await chooseTake(project.draft, presenter || project.presenter, session.cache, Number(index), file, project.dir);
  project.choices = Object.fromEntries(session.cache.choices);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ chosen: picked }));
}

// Films more takes of a segment's line with a direction added, and keeps the best new one for the next cut, streaming
// its progress to the page.
async function retake({ session: id = "", presenter = "", index = "", direction = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { emit, signal, end } = openEvents(res);
  try {
    const session = sessions.get(id);
    const project = session?.project;
    if (!session || !project) throw new Error(GONE);
    const kept = await retakeSegment(project.draft, presenter || project.presenter, session.cache, Number(index), direction, (percent) => emit("progress", { percent }), signal, project.dir);
    project.choices = Object.fromEntries(session.cache.choices);
    await saveProject(project);
    emit("done", { chosen: serve(kept.file), cost: kept.cost, heard: kept.heard });
  } catch (error) {
    if (!signal.aborted) emit("failure", { message: failed("The retake", error) });
  }
  end();
}

// The session for a video made before. Every page open on it shares the same one, so no page saves over another.
async function sessionFor(video: string): Promise<{ id: string; session: Session; project: Project }> {
  const loaded = await loadProject(video);
  const found = [...sessions].find(([, session]) => session.project?.dir === loaded.dir);
  const [id, session] = found ?? [randomUUID(), { project: loaded, cache: newCache(loaded.choices), filming: false }];
  sessions.set(id, session);
  return { id, session, project: session.project ?? loaded };
}

// Opens a video made before, to keep working on it: its conversation, latest script, notes, and latest cut.
async function open({ video = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const { id, project } = await sessionFor(video);
  const { draft, cut } = project;
  const pr = "pr" in draft.source ? draft.source.pr : undefined;
  const opened = {
    session: id,
    folder: basename(project.dir),
    presenter: project.presenter,
    personality: draft.personality,
    persona: draft.persona,
    title: draft.title,
    pull: pr && { url: pr.url, repo: pr.repo, number: pr.number, title: pr.title, author: pr.author, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles },
    theme: draft.theme,
    sound: { ...DEFAULT_SOUND, ...draft.sound },
    segments: draft.segments,
    history: project.history.map((turn) => (turn.role === "user" && turn.notes ? { ...turn, notes: turn.notes.map(shownNote) } : turn)),
    notes: project.notes.filter((note) => !note.sent).map(shownNote),
    cut: cut && (await cutView(project, cutsOf(project).find((each) => each.made === cut.made) ?? cut)),
    versions: versionsOf(project),
  };
  reply(res, 200, "application/json", JSON.stringify(opened));
}

// What the page needs to show a cut: its video, when each segment plays, its theme and segment names, a strip of its
// frames for the timeline, what it cost, and its transcript to copy.
async function cutView(project: Project, cut: Cut) {
  const strip = await filmstrip(cut.video, cut.parts.at(-1)?.end ?? 0);
  return {
    id: cut.id,
    preview: cut.kind === "preview",
    video: `${serve(cut.video)}?cut=${cut.id}`,
    parts: cut.parts,
    theme: cut.theme,
    segments: cut.segments.map(({ kind, label }) => ({ kind, label })),
    filmstrip: { url: `${serve(strip.file)}?cut=${cut.id}`, frames: strip.frames },
    cost: cut.cost,
    transcript: transcriptOf({ ...project.draft, segments: cut.segments }),
    folder: project.dir,
  };
}

// Every version of the video, oldest first, for the page to pick from.
function versionsOf(project: Project) {
  const current = project.cut && Math.round(project.cut.made);
  return cutsOf(project).map((cut, index) => ({ id: cut.id, number: index + 1, made: cut.made, duration: cut.parts.at(-1)?.end ?? 0, cost: cut.cost, current: Math.round(cut.made) === current, preview: cut.kind === "preview" }));
}

// A version of the video to watch, which changes nothing.
async function showVersion({ session: id = "", cut = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const found = cutsOf(project).find((each) => each.id === Number(cut));
  if (!found) return reply(res, 400, "application/json", JSON.stringify({ error: "There's no such version." }));
  reply(res, 200, "application/json", JSON.stringify(await cutView(project, found)));
}

// Goes back to a version: it becomes the current cut again, and the script goes back to what it was filmed from.
async function restoreVersion({ session: id = "", cut = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  await restoreCut(project, Number(cut));
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ restored: Number(cut) }));
}

// Adds a note on the latest cut, or takes one away. Notes go to Grok with the next message that sends them.
async function notes(action: "add" | "remove", body: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(body.session ?? "")?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  if (action === "add") {
    const on = cutsOf(project).find((each) => each.id === Number(body.cut));
    const note = await addNote(project, Number(body.time), Number(body.x), Number(body.y), String(body.text ?? ""), { cut: on ?? project.cut });
    await saveProject(project);
    return reply(res, 200, "application/json", JSON.stringify({ note: shownNote(note) }));
  }
  project.notes = project.notes.filter((note) => note.id !== body.id);
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ removed: body.id }));
}

function shownNote(note: Note): Note {
  return { ...note, picture: serve(note.picture) };
}

// Grok reviews a cut, the current one unless it's another, and pins a note on each problem it sees, for you to send back
// to it with your next message, or delete.
async function review({ session: id = "", cut = "" }: Record<string, string>, res: ServerResponse): Promise<void> {
  const project = sessions.get(id)?.project;
  if (!project) return reply(res, 400, "application/json", JSON.stringify({ error: GONE }));
  const reviewed = cutsOf(project).find((each) => each.id === Number(cut)) ?? project.cut;
  if (!reviewed) return reply(res, 400, "application/json", JSON.stringify({ error: "Film the video first, then Grok can review it." }));
  const { issues, cost } = await reviewCut(reviewed);
  const added: Note[] = [];
  for (const issue of issues) added.push(await addNote(project, issue.time, issue.x, issue.y, issue.text, { cut: reviewed, by: "grok" }));
  await saveProject(project);
  reply(res, 200, "application/json", JSON.stringify({ notes: added.map(shownNote), cost }));
}

// Presenter Studio: invent or describe a presenter, draw portraits to pick from, film a screen test, and save them for
// the video app.
async function studio(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = url.pathname.slice("/api/studio/".length);
  if (route === "voices") return reply(res, 200, "application/json", JSON.stringify(await listVoices()));
  if (route === "voice") {
    const audio = await previewVoice(url.searchParams.get("voice") ?? "", url.searchParams.get("text") || "Hey, I'm about to explain your pull request.");
    return reply(res, 200, "audio/mpeg", audio);
  }
  if (route === "invent") {
    const { idea = "" } = await readJson(req);
    const { draft } = await inventPresenter(await listVoices(), idea);
    return reply(res, 200, "application/json", JSON.stringify(draft));
  }
  if (route === "video") {
    // Copying a real person's face and voice is only for yourself, or someone who said yes.
    if (url.searchParams.get("consent") !== "yes") {
      return reply(res, 400, "application/json", JSON.stringify({ error: "Confirm that this is you, or that you have their permission to use their face and voice." }));
    }
    const at = url.searchParams.has("at") ? Number(url.searchParams.get("at")) : undefined;
    if (at !== undefined && !(at >= 0)) return reply(res, 400, "application/json", JSON.stringify({ error: "Give the time they're talking as seconds, like 2, or minutes and seconds, like 0:02." }));
    const dir = `output/studio/${randomUUID()}`;
    await mkdir(dir, { recursive: true });
    const video = `${dir}/source${extname(url.searchParams.get("filename") ?? "") || ".mp4"}`;
    // Only the frames and the voice sample are kept: the video can have other people in it, who didn't agree to anything.
    const read = await save(req, createWriteStream(video))
      .then(() => readVideo(video, dir, at))
      .finally(() => rm(video, { force: true }));
    let voice: string | undefined;
    let voiceError: string | undefined;
    if (url.searchParams.get("clone") === "yes") {
      voice = await cloneVoice(read.sample, url.searchParams.get("name") ?? "").catch((error: Error) => {
        voiceError = error.message;
        return undefined;
      });
    }
    const { look, room, speech } = read;
    return reply(res, 200, "application/json", JSON.stringify({ frames: read.frames.map(serve), sample: serve(read.sample), speech, look, room, voice, voiceError }));
  }
  if (route === "portraits") {
    const { look = "", room = "", likeness = "" } = await readJson(req);
    if ((!look.trim() && !likeness) || !room.trim()) return reply(res, 400, "application/json", JSON.stringify({ error: "Describe the presenter and where they film." }));
    const picture = likeness ? new Blob([await readFile(studioPortrait(likeness))], { type: "image/jpeg" }) : undefined;
    const { images, cost } = await drawPortraits(look, room, 4, undefined, picture);
    const dir = `output/studio/${randomUUID()}`;
    await mkdir(dir, { recursive: true });
    const portraits = await Promise.all(
      images.map(async (image, index) => {
        await writeFile(`${dir}/portrait-${index + 1}.jpg`, image);
        return serve(`${dir}/portrait-${index + 1}.jpg`);
      }),
    );
    return reply(res, 200, "application/json", JSON.stringify({ portraits, cost }));
  }
  if (route === "screen-test") {
    const { emit, signal, end } = openEvents(res);
    try {
      const portrait = studioPortrait(url.searchParams.get("portrait") ?? "");
      const file = portrait.replace(/\.jpg$/, `-test-${Date.now()}.mp4`);
      const blob = new Blob([await readFile(portrait)], { type: "image/jpeg" });
      const line = url.searchParams.get("line") || "Hey, I'm about to explain your pull request.";
      // They act the line the way their personality does, if they have one yet.
      const cast = {
        portrait: blob,
        voice: url.searchParams.get("voice") ?? "",
        room: url.searchParams.get("room") ?? "the same place",
        delivery: url.searchParams.get("delivery") || "Friendly and natural, like introducing themselves to their followers.",
      };
      const take = await filmLine(line, cast, file, (percent) => emit("progress", { percent }), signal);
      emit("done", { video: serve(take.file), cost: take.cost });
    } catch (error) {
      if (!signal.aborted) emit("failure", { message: failed("The screen test", error) });
    }
    return end();
  }
  if (route === "save") {
    const { id: editing = "", name = "", look = "", room = "", voice = "", portrait = "", personality = "" } = await readJson(req);
    // A presenter already saved, or a built-in one, can change their name, voice, or personality without new portraits.
    if (editing && !portrait) {
      const before = await findPresenter(editing);
      await savePresenter({ ...before, name: name.trim() || before.name, voice: voice || before.voice, personality: personality || before.personality });
      return reply(res, 200, "application/json", JSON.stringify({ id: before.id, face: before.face }));
    }
    const image = await readFile(studioPortrait(portrait));
    const { face } = await findFace(new Blob([image], { type: "image/jpeg" }));
    const id = editing || (await newPresenterId(name));
    await savePresenter({ id, name: name.trim() || id, voice, look, room, face, personality: personality || undefined }, image);
    return reply(res, 200, "application/json", JSON.stringify({ id, face }));
  }
  reply(res, 404, "text/plain", "Not found");
}

// Personality Studio: write a personality from an idea, as a surprise, or from an X account's posts, or start from any
// personality there is, try it out in sample lines and in a screen test, and save it for the video app.
async function personalityStudio(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = url.pathname.slice("/api/personalities/".length);
  if (route === "list") return reply(res, 200, "application/json", JSON.stringify(await listPersonalities()));
  if (route === "write") {
    const { idea = "" } = await readJson(req);
    const handle = /^\s*@|(?:x|twitter)\.com\//i.test(idea) ? parseHandle(idea) : undefined;
    if (/^\s*@/.test(idea) && !handle) return reply(res, 400, "application/json", JSON.stringify({ error: `"${idea.trim()}" isn't an X handle.` }));
    const { persona } = handle ? await personaFromX(handle) : await inventPersonality(idea);
    return reply(res, 200, "application/json", JSON.stringify(persona));
  }
  if (route === "lines") {
    const { name = "", summary = "", style = "", delivery = "", topic = "" } = await readJson(req);
    if (!style.trim()) return reply(res, 400, "application/json", JSON.stringify({ error: "Say how they talk first." }));
    const { lines, cost } = await sampleLines({ name, summary, style, delivery }, topic);
    return reply(res, 200, "application/json", JSON.stringify({ lines, cost }));
  }
  if (route === "save") {
    const { name = "", summary = "", style = "", delivery = "" } = await readJson(req);
    return reply(res, 200, "application/json", JSON.stringify({ id: await savePersonality({ name, summary, style, delivery }) }));
  }
  if (route === "screen-test") {
    const { emit, signal, end } = openEvents(res);
    try {
      const presenter = await findPresenter(url.searchParams.get("presenter") ?? "");
      const [line, delivery] = [url.searchParams.get("line") ?? "", url.searchParams.get("delivery") ?? ""];
      if (!line.trim() || !delivery.trim()) throw new Error("Write how they act on camera, and try it out for a line to film.");
      const { portrait } = await drawPresenter(presenter, signal);
      await mkdir("output/personalities/tests", { recursive: true });
      const cast = { portrait, voice: presenter.voice, room: presenter.room, delivery };
      const take = await filmLine(line, cast, `output/personalities/tests/${Date.now()}.mp4`, (percent) => emit("progress", { percent }), signal);
      emit("done", { video: serve(take.file), cost: take.cost });
    } catch (error) {
      if (!signal.aborted) emit("failure", { message: failed("The screen test", error) });
    }
    return end();
  }
  reply(res, 404, "text/plain", "Not found");
}

// The file behind a portrait's URL, if the studio drew it.
function studioPortrait(url: string): string {
  const path = pathOf(url);
  if (!path?.startsWith("output/studio/") || !path.endsWith(".jpg")) throw new Error("Pick one of the portraits the studio drew.");
  return path;
}

function serve(path: string): string {
  files.add(path);
  return `/files/${encodeURIComponent(path)}`;
}

function pathOf(url: string): string | undefined {
  const path = url.startsWith("/files/") ? decodeURIComponent(url.slice("/files/".length)) : "";
  return files.has(path) ? path : undefined;
}

// The message for a failure, which also goes in the server's log, where it's still there after the page has moved on. A
// failure with a cause, like a dropped connection, says only "fetch failed", so it's logged whole: its stack shows which
// call it was, and its cause shows why.
function failed(what: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${new Date().toLocaleTimeString()} ${what} failed: ${message}`);
  if (error instanceof Error && error.cause) console.error(error);
  return message;
}

// Starts a stream of server-sent events. The signal aborts when the page closes the stream, which stops the API calls and
// rendering. Videos that have already started still finish rendering and are billed, because the API can't cancel one, and
// filming again picks them up.
function openEvents(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  return {
    emit: (event: string, data: object) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    signal: abort.signal,
    end: () => {
      abort.abort();
      res.end();
    },
  };
}

// A request's body as bytes, up to `limit` of them, for a small upload like a logo.
async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error(`That file is too big. It has to be smaller than ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// Browsers load video in byte ranges, which lets them seek. Any other request gets the whole file.
async function sendFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const { size } = await stat(path);
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) {
    res.writeHead(416, { "content-range": `bytes */${size}` }).end();
    return;
  }
  res.writeHead(range ? 206 : 200, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    // Making a video of the same pull request again writes new files under the same names.
    "cache-control": "no-cache",
    ...(range && { "content-range": `bytes ${start}-${end}/${size}` }),
  });
  // Browsers drop a video request partway through when they seek, so a response that closes early isn't an error.
  pipeline(createReadStream(path, { start, end }), res, () => {});
}

function reply(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { "content-type": type }).end(body);
}
