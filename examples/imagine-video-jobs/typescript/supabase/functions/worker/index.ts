import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodeBase64 } from "@std/encoding/base64";
import { ApiError, fakeVideos, realVideos, type VideoApi } from "./videos.ts";

// Supplied by the Edge Runtime: keeps the function alive until the promise settles.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const MODEL = "grok-imagine-video-1.5";
const START_PER_RUN = 3;   // new renders started per run
const CHECK_PER_RUN = 10;  // running renders checked per run

type Generation = {
  id: string; user_id: string; prompt: string; source_path: string | null;
  duration_seconds: number; resolution: "480p" | "720p"; request_id: string | null; estimated_usd: number;
};

export default {
  // pg_cron calls this every 10 seconds with the project's secret key, so no user can.
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    const videos = Deno.env.get("FAKE_XAI") === "1" ? fakeVideos : realVideos(Deno.env.get("XAI_API_KEY"));
    const run = work(ctx.supabaseAdmin, videos);
    // Tests pass ?wait=1 to get a summary. pg_cron doesn't wait, so the run finishes in the background.
    if (new URL(req.url).searchParams.has("wait")) return Response.json(await run);
    EdgeRuntime.waitUntil(run.catch((error) => console.error("worker run failed:", error)));
    return Response.json({ accepted: true }, { status: 202 });
  }),
};

async function work(db: SupabaseClient, videos: VideoApi) {
  await rows(db.rpc("fail_stuck_generations"));
  const toStart = await rows<Generation>(db.rpc("claim_queued_generations", { max_rows: START_PER_RUN }));
  const toCheck = await rows<Generation>(db.rpc("claim_running_generations", { max_rows: CHECK_PER_RUN }));
  await Promise.all([...toStart.map((g) => start(db, videos, g)), ...toCheck.map((g) => check(db, videos, g))]);
  return { mode: videos.mode, started: toStart.map((g) => g.id), checked: toCheck.map((g) => g.id) };
}

// Starts the render and stores its request id. Only a failed API call marks the job failed. If
// saving the id fails, the row stays 'starting' and the sweeper fails it as possibly billed.
async function start(db: SupabaseClient, videos: VideoApi, g: Generation) {
  let image: { url: string } | undefined;
  try {
    image = g.source_path ? { url: await dataUrl(db, g.source_path) } : undefined;
  } catch (error) {
    return save(db, g.id, { status: "failed", error: messageOf(error), finished_at: now() });
  }
  let requestId: string;
  try {
    ({ request_id: requestId } = await videos.generate({
      model: MODEL, prompt: g.prompt, duration: g.duration_seconds, resolution: g.resolution, image, user: g.user_id,
    }));
  } catch (error) {
    // A 4xx means the API turned the job away, so nothing is billed. A timeout, a dropped connection, or a
    // 5xx may come after the render started, so the job keeps its estimate, like one the sweeper fails.
    const rejected = error instanceof ApiError && error.status < 500;
    const fields = rejected ? {} : { cost_usd: g.estimated_usd };
    const note = rejected ? "" : " The render may still have started, so it's counted as billed.";
    return save(db, g.id, { status: "failed", error: messageOf(error) + note, finished_at: now(), ...fields });
  }
  await save(db, g.id, { status: "running", request_id: requestId, started_at: now(), error: null });
}

// Asks once whether the render is done. This doesn't block: there's no videos.wait() in a function with a time limit.
async function check(db: SupabaseClient, videos: VideoApi, g: Generation) {
  try {
    const result = await videos.get(g.request_id!);
    if (result.status === "pending") return await save(db, g.id, { progress: Math.min(result.progress ?? 0, 99), error: null });
    const cost_usd = result.usage?.cost_in_usd_ticks != null ? result.usage.cost_in_usd_ticks / 1e10 : null;
    if (result.status === "done" && result.video?.url && result.video.respect_moderation !== false) {
      const video_path = `${g.user_id}/${g.id}.mp4`;
      const bytes = await videos.download(result.video.url);
      const { error } = await db.storage.from("videos").upload(video_path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) throw error;
      return await save(db, g.id, { status: "done", progress: 100, video_path, cost_usd: cost_usd ?? g.estimated_usd, finished_at: now(), error: null });
    }
    const error = result.status === "done"
      ? "The video didn't pass moderation, so there's no file to keep."
      : result.error?.message ?? `The render ended with status ${result.status}.`;
    await save(db, g.id, { status: "failed", error, cost_usd, finished_at: now() });
  } catch (error) {
    // A network error shouldn't lose the job. Clearing the lease lets the next run check again.
    console.error(`check ${g.id}:`, error);
    await save(db, g.id, { error: messageOf(error) });
  }
}

async function dataUrl(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from("sources").download(path);
  if (error) throw new Error(`Couldn't read the source image: ${error.message}`);
  return `data:${data.type || "image/jpeg"};base64,${encodeBase64(await data.arrayBuffer())}`;
}

async function save(db: SupabaseClient, id: string, fields: Record<string, unknown>) {
  const { error } = await db.from("generations").update({ ...fields, lease_until: null }).eq("id", id);
  if (error) throw new Error(`Couldn't update generation ${id}: ${error.message}`);
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as T[];
}
const now = () => new Date().toISOString();
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
