import type { VideoGenerateParams, VideoResponse } from "@xai-official/sdk";

// The worker talks to the same two endpoints as the SDK's videos.generate() and videos.get(),
// and uses the SDK's types for them. The SDK itself needs Node.js 22.13, and the Edge Runtime
// reports Node.js 20.
export type GenerateBody = Omit<VideoGenerateParams, "image"> & { image?: { url: string } };
export type VideoStatus = Omit<VideoResponse, "usage" | "http"> & { usage?: { cost_in_usd_ticks: number } | null };
export type VideoApi = {
  mode: "real" | "fake";
  generate(body: GenerateBody): Promise<{ request_id: string }>;
  get(requestId: string): Promise<VideoStatus>;
  download(url: string): Promise<Uint8Array>;
};

const API = "https://api.x.ai/v1";

// An answer from the API. A 4xx means it turned the request away; a 5xx or no answer at all leaves it unknown.
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function realVideos(apiKey: string | undefined): VideoApi {
  async function call(path: string, init: RequestInit): Promise<Response> {
    if (!apiKey) throw new Error("XAI_API_KEY isn't set for the worker. Put it in .env at the root of the repo and run npm run supabase:start, or use npm run supabase:fake.");
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new ApiError(res.status, `SpaceXSI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
  return {
    mode: "real",
    async generate(body) {
      return (await call("/videos/generations", { method: "POST", body: JSON.stringify(body) })).json();
    },
    async get(requestId) {
      // Pending renders answer 202, sometimes with no body.
      const res = await call(`/videos/${encodeURIComponent(requestId)}`, { method: "GET" });
      const text = await res.text();
      return res.status === 202 && !text ? { status: "pending" } : JSON.parse(text);
    },
    async download(url) {
      // Video URLs are temporary, so the worker copies the file to Storage as soon as it's done.
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Couldn't download the video: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// FAKE_XAI=1: pretends to render. Every job takes 12 seconds and returns a 3-second test pattern.
// A prompt containing [fail] fails, so the failure path can be tried too. The request id carries
// the start time, so the fake keeps working across worker runs and restarts.
const FAKE_RENDER_MS = 12_000;
const fakeClip = Deno.readFile(new URL("./fake-video.mp4", import.meta.url)); // in static_files

export const fakeVideos: VideoApi = {
  mode: "fake",
  async generate(body) {
    const kind = body.prompt?.includes("[fail]") ? "fail-" : "";
    return { request_id: `fake-${kind}${Date.now()}-${crypto.randomUUID()}` };
  },
  async get(requestId) {
    const [, fail, started] = requestId.match(/^fake-(fail-)?(\d+)-/) ?? [];
    const elapsed = Date.now() - Number(started);
    if (elapsed < FAKE_RENDER_MS) return { status: "pending", progress: Math.floor((elapsed / FAKE_RENDER_MS) * 100) };
    if (fail) return { status: "failed", error: { code: "invalid_argument", message: "Fake failure: the prompt asked for one with [fail]." } };
    return { status: "done", progress: 100, video: { url: "fake://clip", duration: 3, respect_moderation: true }, usage: null };
  },
  async download() {
    return await fakeClip;
  },
};
