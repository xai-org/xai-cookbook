import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { SpaceXAI, type VideoGenerateParams, type VideoResponse } from "@xai-official/sdk";

const client = new SpaceXAI();

export const SECONDS = 10;
// Keyframes snap to a grid of thirds of a second, so every stage is placed on that grid.
const SLOTS_PER_SECOND = 3;
// The first and last stages pin the first and last frames, and the API takes at most four keyframes between them.
const MAX_STAGES = 6;
const POLL_MS = 5_000;
const VIDEO_TIMEOUT_MS = 10 * 60_000;

const PRESETS: Record<string, string> = {
  seasons: "The same place through the four seasons, from winter to autumn.",
  "day-to-night": "One day, from early morning to late at night.",
  "sketch-to-painting": "A pencil sketch of the scene that becomes a finished oil painting.",
  construction: "The main building goes up, from an empty lot to the finished building.",
};

// Takes a preset's id, or a change described in words.
export function describeChange(change: string): string {
  return Object.hasOwn(PRESETS, change) ? PRESETS[change] : change;
}

// `at` is when the video reaches the stage, in seconds from the start.
export type Stage = { label: string; edit: string; at: number };
export type Plan = { title: string; stages: Stage[]; motion: string };
export type TimeLapse = { dir: string; plan: Plan; cost: number };
// An image or a video, and what it cost in US dollars.
type Media = { bytes: Buffer<ArrayBuffer>; cost: number };

export type TimeLapseEvents = {
  step?: (step: "plan" | "stills" | "video") => void;
  reasoning?: (text: string) => void;
  stage?: (stage: Stage, index: number) => void;
  plan?: (plan: Plan) => void;
  still?: (index: number, path: string) => void;
  progress?: (percent: number) => void;
};

const PLAN_PROMPT = `You plan a time-lapse made from a single photo. Each stage of the change becomes an edit of the photo, and a video model pins every edit at its moment in a ${SECONDS}-second clip and animates the change between them. The camera never moves, so every edit keeps the photo's exact framing.

Look at the photo and the change you're asked for, then plan it:
- title: a short title for the time-lapse.
- stages: four moments of the change in order, unless the request asks for a different number, from two to six. The first one opens the video and the last one ends it. For each stage:
  - label: a name in one to three words, like "Winter" or "Blue hour".
  - edit: an instruction for an image editor that turns the photo into this moment, in one or two sentences. Say what changes and how it looks, like the light, the weather, the trees, or the materials. Leave out anything about the camera, and don't add or remove things the change doesn't touch.
  - at: when the video reaches this stage, in seconds from 0 to ${SECONDS}. The first stage is at 0 and the last at ${SECONDS}. Put the ones between where the change needs time, at least 1.5 seconds apart.
- motion: one or two sentences for the video model on how the scene changes from stage to stage, like snow melting or lights coming on in the windows.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    stages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          edit: { type: "string" },
          at: { type: "number" },
        },
        required: ["label", "edit", "at"],
        additionalProperties: false,
      },
    },
    motion: { type: "string" },
  },
  required: ["title", "stages", "motion"],
  additionalProperties: false,
};

// Makes the time-lapse and saves it to output/<title>/, reporting each step as it starts and each
// result as soon as it's ready.
export async function makeTimeLapse(photo: Blob, request: string, on: TimeLapseEvents = {}, signal?: AbortSignal): Promise<TimeLapse> {
  on.step?.("plan");
  const plan = await planStages(photo, request, on, signal);
  on.plan?.(plan);
  const dir = `output/${slugify(plan.title)}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/plan.json`, JSON.stringify(plan, null, 2));

  on.step?.("stills");
  const stills = await Promise.all(
    plan.stages.map(async (stage, index) => {
      const still = await editPhoto(photo, stage, signal);
      const path = `${dir}/stage-${index + 1}.jpg`;
      await writeFile(path, still.bytes);
      on.still?.(index, path);
      return still;
    }),
  );

  on.step?.("video");
  const video = await renderVideo(plan, stills.map((still) => still.bytes), on, signal);
  await writeFile(`${dir}/time-lapse.mp4`, video.bytes);
  return { dir, plan, cost: stills.reduce((sum, still) => sum + still.cost, video.cost) };
}

// Streams the plan, reporting Grok's reasoning and each stage as soon as it's written.
async function planStages(photo: Blob, request: string, on: TimeLapseEvents, signal?: AbortSignal): Promise<Plan> {
  let written = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: PLAN_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_image", image: photo, detail: "high" },
            { type: "input_text", text: request },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "time_lapse_plan", schema: PLAN_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    // The plan so far. Each stage is finished once the next one starts, and the last one once Grok
    // starts on the motion, which comes after the stages.
    .on("json", (value) => {
      const { stages = [], motion } = value as Partial<Plan>;
      const finished = motion === undefined ? stages.length - 1 : stages.length;
      for (; written < finished; written++) on.stage?.({ ...stages[written], at: snap(stages[written].at) }, written);
    })
    .done();
  const plan = response.toJson() as Plan;
  if (plan.stages.length < 2) throw new Error("Grok planned fewer than two stages");
  const stages = placeStages(plan.stages.slice(0, MAX_STAGES));
  for (; written < stages.length; written++) on.stage?.(stages[written], written);
  return { ...plan, stages };
}

// The first stage opens the clip and the last one closes it. The stages between become keyframes, which
// have to fall strictly inside the clip, each in its own slot of the grid, so a stage that lands on a
// taken slot moves to the next free one.
function placeStages(stages: Stage[]): Stage[] {
  const end = SECONDS * SLOTS_PER_SECOND;
  let previous = -1;
  return stages.map((stage, index) => {
    const after = stages.length - 1 - index;
    const wanted = index === 0 ? 0 : after === 0 ? end : Math.round(stage.at * SLOTS_PER_SECOND);
    const slot = Math.min(Math.max(wanted, previous + 1), end - after);
    previous = slot;
    return { ...stage, at: slot / SLOTS_PER_SECOND };
  });
}

function snap(seconds: number): number {
  return Math.round(seconds * SLOTS_PER_SECOND) / SLOTS_PER_SECOND;
}

// Every stage is an edit of the original photo, not of the stage before it, so the framing stays the
// same in all of them and small changes don't pile up from stage to stage.
async function editPhoto(photo: Blob, stage: Stage, signal?: AbortSignal): Promise<Media> {
  const result = await client.images.edit(
    {
      model: "grok-imagine-image-2.0",
      image: photo,
      prompt: `${stage.edit} Keep the camera angle, framing, and perspective exactly as they are, and leave everything this edit doesn't mention where it is.`,
      response_format: "b64_json",
    },
    { signal },
  );
  const b64 = result.data[0]?.b64_json;
  if (!b64) throw new Error(`The edit for ${stage.label} had no image data`);
  return { bytes: Buffer.from(b64, "base64"), cost: result.usage?.cost_usd ?? 0 };
}

// Pins the first still as the first frame, the last one as the last frame, and the ones between as
// keyframes at their stage's time.
async function renderVideo(plan: Plan, stills: Buffer<ArrayBuffer>[], on: TimeLapseEvents, signal?: AbortSignal): Promise<Media> {
  const [first, ...between] = stills.map((bytes) => new Blob([bytes], { type: "image/jpeg" }));
  between.pop();
  const last = stills[stills.length - 1];
  const { request_id } = await client.videos.generate(
    {
      model: "grok-imagine-video-1.5",
      prompt: `A time-lapse filmed from a camera locked off on a tripod, so the framing never moves. ${plan.motion}`,
      image: first,
      keyframes: between.map((image, index) => ({ image, timestamp_s: plan.stages[index + 1].at })),
      // SDK 0.2.2 doesn't have `last_frame` yet, so it's added with a cast. The image goes in as a data URL,
      // because the SDK only turns Blobs into data URLs in the fields it knows.
      last_frame: { url: `data:image/jpeg;base64,${last.toString("base64")}` },
      duration: SECONDS,
      resolution: "720p",
    } as VideoGenerateParams,
    { signal },
  );
  const result = await waitForVideo(request_id, on, signal);
  if (result.status !== "done" || !result.video?.url) {
    throw new Error(`The video failed to render: ${result.status} ${result.error?.message ?? ""}`);
  }
  // The URL is temporary, so the video is saved right away.
  const video = await fetch(result.video.url, { signal });
  if (!video.ok) throw new Error(`Couldn't download the video: ${video.status}`);
  return { bytes: Buffer.from(await video.arrayBuffer()), cost: result.usage?.cost_usd ?? 0 };
}

// videos.wait() would also poll until the video is done, but it doesn't report the progress the API
// sends along the way.
async function waitForVideo(requestId: string, on: TimeLapseEvents, signal?: AbortSignal): Promise<VideoResponse> {
  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await client.videos.get(requestId, { signal });
    if (result.status !== "pending") return result;
    on.progress?.(result.progress ?? 0);
    await sleep(POLL_MS, undefined, { signal });
  }
  throw new Error(`The video wasn't done after ${VIDEO_TIMEOUT_MS / 60_000} minutes`);
}

// Times on the grid read as thirds, like 3⅔ s.
export function formatMark(seconds: number): string {
  const thirds = Math.round(seconds * SLOTS_PER_SECOND);
  return `${Math.floor(thirds / SLOTS_PER_SECOND)}${["", "⅓", "⅔"][thirds % SLOTS_PER_SECOND]} s`;
}

function slugify(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "time-lapse";
}
