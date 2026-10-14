import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { assetsBrief, listAssets } from "./library.ts";
import { type Project, keepCut, newProject, saveProject } from "./project.ts";
import { setTheme } from "./script.ts";
import { filmDraft, newCache, reviseDraft, startDraft } from "./short.ts";
import { freshTheme } from "./themes.ts";

// Several videos made at once: a script for each source, written in the background without stopping for questions, and
// a free preview of each, if asked for, to watch before picking which to film. Each one becomes a video like any other,
// and the batch is saved in output/batches/, so its page shows it after a reload.
export type Batch = { id: string; made: number; presenter: string; personality: string; preview: boolean; items: BatchItem[] };
export type BatchItem = { source: string; status: "waiting" | "writing" | "previewing" | "ready" | "failed"; folder?: string; title?: string; theme?: string; preview?: number; error?: string };

// How the batch hands each new video to the server, which keeps it open like one made in the chat, so a page that opens
// it while the batch is still previewing it works on the same video. It says whether the video's being filmed, too.
export type Adopt = (project: Project) => { filming: boolean };

const DIR = "output/batches";
// Scripts written at once, and the most sources a batch takes.
const WRITERS = 3;
const MOST = 12;
const running = new Map<string, Batch>();

export async function startBatch(sources: string[], presenter: string, personality: string, preview: boolean, avoid: string[], adopt: Adopt): Promise<Batch> {
  const lines = sources.map((source) => source.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Write one source on each line: a pull request, an idea, or a link.");
  if (lines.length > MOST) throw new Error(`A batch takes up to ${MOST} sources at a time.`);
  const batch: Batch = { id: randomUUID().slice(0, 8), made: Date.now(), presenter, personality, preview, items: lines.map((source) => ({ source, status: "waiting" })) };
  running.set(batch.id, batch);
  await saveBatch(batch);
  run(batch, avoid, adopt).finally(() => running.delete(batch.id));
  return batch;
}

// Every batch, newest first. One that was running when the server stopped says so on what it didn't finish.
export async function listBatches(): Promise<Batch[]> {
  const files = existsSync(DIR) ? (await readdir(DIR)).filter((name) => name.endsWith(".json")) : [];
  const saved: Batch[] = await Promise.all(files.map(async (name) => JSON.parse(await readFile(`${DIR}/${name}`, "utf8"))));
  return saved.map((batch) => running.get(batch.id) ?? { ...batch, items: batch.items.map(stopped) }).sort((a, b) => b.made - a.made);
}

function stopped(item: BatchItem): BatchItem {
  if (item.status === "ready" || item.status === "failed") return item;
  return { ...item, status: item.folder ? "ready" : "failed", error: "The server stopped before this finished." };
}

// Writes three scripts at a time, then previews the ones that worked, one at a time, since drawing a video takes the
// whole computer. Each new theme joins `avoid`, so the batch's videos look different from each other too.
async function run(batch: Batch, avoid: string[], adopt: Adopt): Promise<void> {
  const used = [...avoid];
  const projects = new Map<BatchItem, Project>();
  const queue = [...batch.items];
  const writer = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const project = await write(batch, item, used);
      if (project) projects.set(item, project);
    }
  };
  await Promise.all(Array.from({ length: WRITERS }, writer));
  if (!batch.preview) return;
  for (const [item, project] of projects) await preview(batch, item, project, adopt(project));
}

async function write(batch: Batch, item: BatchItem, used: string[]): Promise<Project | undefined> {
  item.status = "writing";
  await saveBatch(batch);
  try {
    const uploads = assetsBrief(await listAssets());
    let written = await startDraft(item.source, batch.presenter, batch.personality, {}, undefined, uploads, used);
    if (!written.draft.segments.length) written = await reviseDraft(written.draft, "I can't answer right now, so go with your best judgment.", batch.personality);
    // Scripts written at the same time can't see each other's themes, so a theme already taken goes to an unused one.
    if (used.includes(written.draft.theme)) written = { ...written, draft: setTheme(written.draft, freshTheme(used, written.draft.title)) };
    used.push(written.draft.theme);
    const project = await newProject(written.draft, batch.presenter);
    project.history.push({ role: "user", text: item.source }, { role: "grok", note: written.note });
    project.briefed = uploads;
    await saveProject(project);
    Object.assign(item, { status: "ready", folder: basename(project.dir), title: written.draft.title, theme: written.draft.theme });
    await saveBatch(batch);
    return project;
  } catch (error) {
    Object.assign(item, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    await saveBatch(batch);
    return undefined;
  }
}

// A free preview of one video, kept as a version of it, unless someone started filming it from its page first.
async function preview(batch: Batch, item: BatchItem, project: Project, session: { filming: boolean }): Promise<void> {
  if (session.filming) return;
  session.filming = true;
  item.status = "previewing";
  await saveBatch(batch);
  try {
    const short = await filmDraft(project.draft, batch.presenter, newCache(), {}, undefined, project.dir, { preview: true });
    const made = Date.now();
    const cost = short.cost.presenter + short.cost.media + short.cost.takes;
    const cut = await keepCut(project, { id: made, video: short.video, made, parts: short.parts, words: short.words, segments: project.draft.segments, theme: project.draft.theme, cost, takes: short.takes.map((take) => take.file), kind: "preview" });
    await saveProject(project);
    Object.assign(item, { status: "ready", preview: cut.id });
  } catch (error) {
    Object.assign(item, { status: "ready", error: `The preview didn't work: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    session.filming = false;
  }
  await saveBatch(batch);
}

async function saveBatch(batch: Batch): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}/${batch.id}.json`, JSON.stringify(batch, null, 2));
}
