import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { type BatchResult, type CreateParams, SpaceXAI } from "@xai-official/sdk";

// Live mode sends CONCURRENCY labeling requests at once, which can run into a rate limit, so a 429 gets a few
// more retries than the SDK's default of two. The SDK waits as long as the API asks before each one.
const client = new SpaceXAI({ maxRetries: 5 });

// The models that can label the reviews. grok-4.7 doesn't take batch requests: a batch with it in it is cancelled
// with "Model grok-4.7 is not supported for batch processing", so it always labels live.
export const MODELS = ["grok-4.3", "grok-4.20-0309-non-reasoning", "grok-4.20-0309-reasoning", "grok-4.7"];
export const BATCH_MODELS = ["grok-4.3", "grok-4.20-0309-non-reasoning", "grok-4.20-0309-reasoning"];
export const DEFAULT_MODEL = "grok-4.3";

// Grok reads this many reviews to find the candidate themes, and each labeling request carries CHUNK_SIZE.
const SAMPLE_SIZE = 150;
const CHUNK_SIZE = 25;
// How many labeling requests live mode sends at once.
const CONCURRENCY = 8;
const POLL_MS = 3_000;
const DAY_MS = 86_400_000;

export type Review = { id: string; date: string | null; rating: number | null; text: string };
export type Candidate = { id: string; name: string; description: string };
// The themes Grok found in each review, by review ID, with the words that show each one.
export type Labels = Record<string, Array<{ theme: string; quote: string }>>;
export type Mode = "batch" | "live";
export type Trend = { label: string; direction: "up" | "down" | "flat"; recent: number; before: number; weeks: number };
export type Theme = {
  name: string;
  summary: string;
  candidates: string[];
  rows: string[];
  weekly: number[];
  trend: Trend | null;
  rating: number | null;
  quotes: Array<{ id: string; quote: string }>;
};
export type Result = { themes: Theme[]; unthemed: string[]; unlabeled: string[]; weeks: string[]; cost: number; seconds: number };

// Everything a run needs to pick up where it left off, saved to run.json in its folder.
export type Run = {
  source: string;
  model: string;
  mode: Mode;
  reviews: Review[];
  candidates: Candidate[];
  // The review IDs in each labeling request, in the order of the batch file.
  chunks: string[][];
  batch?: { id: string; file: string };
  // What finding the candidate themes cost.
  cost: number;
  started: string;
  finished?: boolean;
};

export type RunEvents = {
  step?: (step: "find" | "label" | "name") => void;
  reasoning?: (text: string) => void;
  candidate?: (candidate: Candidate) => void;
  batch?: (batch: { id: string; file: string; requests: number }) => void;
  progress?: (progress: { done: number; failed: number; total: number; reviews: number }) => void;
  labels?: (labels: Labels) => void;
  // A labeling request failed. Its reviews stay unlabeled and the run goes on.
  failed?: (error: string) => void;
  cost?: (cost: number) => void;
};

const FIND_PROMPT = `You find the themes in customer reviews. Read this sample from a larger set and list the themes that come up in more than one review: specific problems, requests, and kinds of praise.
- Name each theme by what people say, not by a category like "Bugs".
- Keep each theme to one issue, so a review about two issues counts toward two themes.
- Leave out one-off comments.
For each theme, give a short kebab-case ID, a name of at most six words, and one sentence on what a review has to say to count, for whoever labels the rest of the reviews.`;

const NAME_PROMPT = `You turn candidate themes from customer reviews into the final list. Each candidate comes with the number of reviews that mention it and some quotes from them.
- Merge candidates that are really the same issue, and keep the others separate. Every candidate goes into exactly one theme.
- name: a fresh name from the quotes, in at most six words that read naturally to someone skimming a dashboard, like "Checkout fails on Android", "Wants a dark mode", or "Fast, friendly delivery".
- summary: one or two sentences on what people say about it, from the quotes.`;

const CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "[a-z0-9]+(-[a-z0-9]+)*" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "name", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["themes"],
  additionalProperties: false,
};

// Reads reviews from CSV text. Each review's ID is its row number, so results can point back to the file.
export function readReviews(csv: string): Review[] {
  const [header = [], ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));
  const columns = header.map((name) => name.trim().toLowerCase());
  const find = (names: string[]) => columns.findIndex((name) => names.includes(name));
  const text = find(["text", "review", "body", "content", "comment", "message", "feedback"]);
  const date = find(["date", "created_at", "created", "submitted_at", "timestamp"]);
  const rating = find(["rating", "stars", "score"]);
  if (text < 0) throw new Error(`The CSV needs a column of text named text, review, body, or comment. Its columns are: ${header.join(", ")}`);
  return rows
    .map((row, index) => ({
      id: String(index + 1),
      date: date < 0 ? null : isoDate(row[date]),
      rating: rating < 0 ? null : Number(row[rating]) || null,
      text: (row[text] ?? "").trim(),
    }))
    .filter((review) => review.text);
}

// Starts a run: finds candidate themes in a sample, labels every review against them, then merges and names the
// themes. Saves everything to dir, and reports each step as it happens.
export async function analyze(dir: string, source: string, reviews: Review[], model: string, mode: Mode, on: RunEvents = {}, signal?: AbortSignal): Promise<Result> {
  const started = new Date().toISOString();
  on.step?.("find");
  const found = await findCandidates(reviews, on, signal);
  if (!found.candidates.length) throw new Error("Grok didn't find any themes in the sample");
  const chunks = Array.from({ length: Math.ceil(reviews.length / CHUNK_SIZE) }, (_, i) => reviews.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).map((review) => review.id));
  const run: Run = { source, model, mode, reviews, candidates: found.candidates, chunks, cost: found.cost, started };
  on.cost?.(run.cost);
  on.step?.("label");
  if (mode === "batch") {
    run.batch = await submitBatch(run, signal);
    // The batch ID is all it takes to get the results later, so it's saved before anything else can go wrong.
    await saveRun(dir, run);
    on.batch?.({ ...run.batch, requests: chunks.length });
  }
  return finish(dir, run, on, signal);
}

// Picks up a saved batch run. The batch kept running at SpaceXAI while nothing was waiting for it, so its results
// are there to read.
export async function resume(dir: string, on: RunEvents = {}, signal?: AbortSignal): Promise<Result> {
  const run = await loadRun(dir);
  if (!run?.batch || run.finished) throw new Error(`There's no unfinished batch in ${dir}`);
  for (const candidate of run.candidates) on.candidate?.(candidate);
  on.cost?.(run.cost);
  on.step?.("label");
  on.batch?.({ ...run.batch, requests: run.chunks.length });
  return finish(dir, run, on, signal);
}

// Cancels a saved run's batch, if it's still going. Requests that already finished are still billed.
export async function cancel(dir: string): Promise<boolean> {
  const run = await loadRun(dir);
  if (!run?.batch || run.finished) return false;
  await client.batches.cancel(run.batch.id);
  await saveRun(dir, { ...run, finished: true });
  return true;
}

export async function loadRun(dir: string): Promise<Run | undefined> {
  try {
    return JSON.parse(await readFile(`${dir}/run.json`, "utf8")) as Run;
  } catch {
    return undefined;
  }
}

async function saveRun(dir: string, run: Run): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/run.json`, JSON.stringify(run));
}

async function finish(dir: string, run: Run, on: RunEvents, signal?: AbortSignal): Promise<Result> {
  const labeled = run.batch ? await waitForBatch(run, on, signal) : await labelLive(run, on, signal);
  on.step?.("name");
  const named = await nameThemes(run, labeled.labels, on, signal);
  const cost = run.cost + labeled.cost + named.cost;
  on.cost?.(cost);
  const result = summarize(run, labeled.labels, named.themes, cost);
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/themes.json`, JSON.stringify({ source: run.source, model: run.model, mode: run.mode, ...result }, null, 2));
  await writeFile(`${dir}/reviews.csv`, reviewsCsv(run.reviews, result.themes));
  if (run.batch) await saveRun(dir, { ...run, finished: true });
  return result;
}

// Streams the candidate themes from a sample of the reviews, reporting each theme as soon as it's written.
async function findCandidates(reviews: Review[], on: RunEvents, signal?: AbortSignal): Promise<{ candidates: Candidate[]; cost: number }> {
  // Every nth review in date order, so the sample covers the whole period, including themes that only started lately.
  const sorted = reviews.toSorted((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const step = Math.max(1, sorted.length / SAMPLE_SIZE);
  const sample = Array.from({ length: Math.min(SAMPLE_SIZE, sorted.length) }, (_, i) => sorted[Math.floor(i * step)].text);
  let reported = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // Low effort is plenty for a list of themes, and finishes in seconds rather than minutes.
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: FIND_PROMPT },
        { role: "user", content: JSON.stringify(sample) },
      ],
      text: { format: { type: "json_schema", name: "candidate_themes", schema: CANDIDATES_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    // The themes so far. Each one is finished once the next one starts.
    .on("json", (value) => {
      const themes = (value as { themes?: Candidate[] }).themes ?? [];
      for (; reported < themes.length - 1; reported++) on.candidate?.(themes[reported]);
    })
    .done();
  const { themes } = response.toJson() as { themes: Candidate[] };
  for (; reported < themes.length; reported++) on.candidate?.(themes[reported]);
  const candidates = [...new Map(themes.map((theme) => [theme.id, theme])).values()];
  return { candidates, cost: response.usage.cost_usd ?? 0 };
}

// One labeling request: a chunk of reviews, the candidate themes, and a schema with one entry per review, so
// none can be skipped, that only allows the candidates' IDs.
function labelRequest(run: Run, ids: string[]): CreateParams {
  const texts = new Map(run.reviews.map((review) => [review.id, review.text]));
  const mentions = {
    type: "array",
    items: {
      type: "object",
      properties: { theme: { type: "string", enum: run.candidates.map((theme) => theme.id) }, quote: { type: "string" } },
      required: ["theme", "quote"],
      additionalProperties: false,
    },
  };
  return {
    model: run.model,
    // grok-4.7 reasons at high effort by default, which takes minutes for each request.
    ...(run.model === "grok-4.7" && { reasoning: { effort: "low" } }),
    input: [
      {
        role: "system",
        content: `You label customer reviews with the themes they mention. The themes:
${run.candidates.map((theme) => `- ${theme.id}: ${theme.name}. ${theme.description}`).join("\n")}

For each review, list every theme it clearly mentions, or none if it fits none of them. For each theme, copy the part of the review that shows it, word for word: the whole sentence if it's short, or the clause that says it, in at most 20 words.`,
      },
      { role: "user", content: JSON.stringify(ids.map((id) => ({ id, text: texts.get(id) }))) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "labels",
        // The schema counts toward the input tokens, so every review refers to one shared definition instead
        // of repeating it, which more than halves each request's input.
        schema: {
          type: "object",
          properties: Object.fromEntries(ids.map((id) => [id, { $ref: "#/$defs/mentions" }])),
          required: ids,
          additionalProperties: false,
          $defs: { mentions },
        },
      },
    },
  };
}

// Writes one labeling request per line to a JSONL file, uploads it, and starts a batch that reads it.
async function submitBatch(run: Run, signal?: AbortSignal): Promise<{ id: string; file: string }> {
  const lines = run.chunks.map((ids, index) =>
    JSON.stringify({
      custom_id: `chunk-${index}`,
      method: "POST",
      url: "/v1/responses",
      // The file goes to the API as it is, without the SDK's defaults, so it asks not to store the responses here.
      body: { ...labelRequest(run, ids), store: false },
    }),
  );
  // The batch reads the file within seconds of starting, so the file can expire after a day.
  const file = await client.files.upload({ file: new Blob([lines.join("\n")]), filename: "labels.jsonl", expires_after: DAY_MS / 1000 }, { signal });
  const batch = await client.batches.create({ name: `Reviews to Themes: ${run.source}`, input_file_id: file.id }, { signal });
  return { id: batch.batch_id, file: file.id };
}

// Polls the batch until every request has finished, reading each result as soon as it's ready.
async function waitForBatch(run: Run, on: RunEvents, signal?: AbortSignal): Promise<{ labels: Labels; cost: number }> {
  const labels: Labels = {};
  const read = new Set<string>();
  let cost = 0;
  let failed = 0;
  while (true) {
    const batch = await client.batches.get(run.batch!.id, { signal });
    if (batch.cancel_by_xai_message) throw new Error(`SpaceXAI cancelled the batch: ${batch.cancel_by_xai_message}`);
    const { num_requests, num_pending, num_success, num_error } = batch.state;
    if (num_success + num_error > read.size) {
      // Reading the results starts from the first one every time, so the ones already read are skipped.
      for await (const result of client.batches.results(run.batch!.id, { limit: 100 }, { signal })) {
        if (read.has(result.batch_request_id)) continue;
        read.add(result.batch_request_id);
        const chunk = run.chunks[Number(result.batch_request_id.replace("chunk-", ""))];
        try {
          const response = readResult(result);
          cost += response.cost;
          const chunkLabels = Object.fromEntries(chunk.map((id) => [id, response.labels[id] ?? []]));
          Object.assign(labels, chunkLabels);
          on.labels?.(chunkLabels);
        } catch (error) {
          failed++;
          on.failed?.(error instanceof Error ? error.message : String(error));
        }
      }
      on.cost?.(run.cost + cost);
    }
    on.progress?.({ done: read.size, failed, total: run.chunks.length, reviews: Object.keys(labels).length });
    // The batch reads its file after it's created, so at first it has no requests at all, and none pending.
    if (num_requests === run.chunks.length && num_pending === 0 && read.size >= num_success + num_error) break;
    await sleep(POLL_MS, undefined, { signal });
  }
  return { labels, cost };
}

function readResult({ batch_result }: BatchResult): { labels: Labels; cost: number } {
  if ("error" in batch_result) throw new Error(batch_result.error);
  if (batch_result.response === "unknown" || !("chat_get_completion" in batch_result.response)) throw new Error("The batch returned an unexpected result");
  const completion = batch_result.response.chat_get_completion;
  // Batch results report their cost in ticks, ten billion to the dollar.
  return { labels: JSON.parse(completion.choices[0]?.message.content ?? ""), cost: (completion.usage?.cost_in_usd_ticks ?? 0) / 1e10 };
}

// Sends the labeling requests itself, a few at a time, for models that can't batch or when results are wanted now.
async function labelLive(run: Run, on: RunEvents, signal?: AbortSignal): Promise<{ labels: Labels; cost: number }> {
  const labels: Labels = {};
  const queue = limit(CONCURRENCY);
  let cost = 0;
  let done = 0;
  let failed = 0;
  on.progress?.({ done, failed, total: run.chunks.length, reviews: 0 });
  await Promise.all(
    run.chunks.map((ids) =>
      queue(async () => {
        // One failed request shouldn't sink the others, so its reviews stay unlabeled and the run goes on.
        try {
          const response = await client.responses.create(labelRequest(run, ids), { signal });
          const chunkLabels = response.toJson() as Labels;
          Object.assign(labels, chunkLabels);
          cost += response.usage.cost_usd ?? 0;
          on.labels?.(chunkLabels);
          on.cost?.(run.cost + cost);
        } catch (error) {
          if (signal?.aborted) throw error;
          failed++;
          on.failed?.(error instanceof Error ? error.message : String(error));
        }
        on.progress?.({ done: ++done, failed, total: run.chunks.length, reviews: Object.keys(labels).length });
      }),
    ),
  );
  return { labels, cost };
}

// The reduce step: with every review counted, Grok merges candidates that turned out to be the same theme and
// names the final ones from what people actually said.
async function nameThemes(run: Run, labels: Labels, on: RunEvents, signal?: AbortSignal): Promise<{ themes: Array<{ name: string; summary: string; candidates: string[] }>; cost: number }> {
  const evidence = run.candidates.map((candidate) => {
    const quotes = Object.values(labels).flatMap((mentions) => mentions.filter((mention) => mention.theme === candidate.id).map((mention) => mention.quote));
    return { ...candidate, reviews: quotes.length, quotes: quotes.slice(-8) };
  });
  const ids = run.candidates.map((candidate) => candidate.id);
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: NAME_PROMPT },
        { role: "user", content: JSON.stringify(evidence) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "themes",
          schema: {
            type: "object",
            properties: {
              themes: {
                type: "array",
                items: {
                  type: "object",
                  // The candidates come first, so Grok decides what goes together before it names it.
                  properties: { candidates: { type: "array", items: { type: "string", enum: ids } }, name: { type: "string" }, summary: { type: "string" } },
                  required: ["candidates", "name", "summary"],
                  additionalProperties: false,
                },
              },
            },
            required: ["themes"],
            additionalProperties: false,
          },
        },
      },
      stream: true,
    },
    { signal },
  );
  const response = await stream.on("reasoning", (text) => on.reasoning?.(text)).done();
  const { themes } = response.toJson() as { themes: Array<{ name: string; summary: string; candidates: string[] }> };
  // A candidate Grok left out keeps its own theme, and one it used twice stays with the first.
  const used = new Set<string>();
  const merged = themes.map((theme) => {
    const candidates = [...new Set(theme.candidates)].filter((id) => !used.has(id));
    for (const id of candidates) used.add(id);
    return { ...theme, candidates };
  });
  const left = run.candidates.filter((candidate) => !used.has(candidate.id)).map((candidate) => ({ name: candidate.name, summary: candidate.description, candidates: [candidate.id] }));
  return { themes: [...merged, ...left].filter((theme) => theme.candidates.length), cost: response.usage.cost_usd ?? 0 };
}

// Counts each theme's reviews week by week, and picks a few quotes from the latest ones.
function summarize(run: Run, labels: Labels, named: Array<{ name: string; summary: string; candidates: string[] }>, cost: number): Result {
  const weeks = weekStarts(run.reviews);
  const newest = run.reviews.toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const themes = named
    .map((theme) => {
      const reviews = newest.filter((review) => labels[review.id]?.some((mention) => theme.candidates.includes(mention.theme)));
      const weekly = weeks.map(() => 0);
      for (const review of reviews) if (review.date) weekly[weekIndex(review.date, weeks)]++;
      const ratings = reviews.flatMap((review) => (review.rating ? [review.rating] : []));
      const quotes = reviews.flatMap((review) => {
        const quote = labels[review.id].find((mention) => theme.candidates.includes(mention.theme))?.quote ?? "";
        // Grok is asked to copy the words exactly, and the few quotes it reworded are left out, along with ones
        // too short to say much on their own.
        return quote.length >= 25 && quote.length <= 140 && review.text.toLowerCase().includes(quote.toLowerCase()) ? [{ id: review.id, quote }] : [];
      });
      return {
        ...theme,
        rows: reviews.map((review) => review.id),
        weekly,
        trend: weeks.length >= 2 ? trend(weekly) : null,
        rating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
        quotes: quotes.slice(0, 3),
      };
    })
    .filter((theme) => theme.rows.length)
    .sort((a, b) => b.rows.length - a.rows.length);
  return {
    themes,
    unthemed: run.reviews.filter((review) => labels[review.id]?.length === 0).map((review) => review.id),
    unlabeled: run.reviews.filter((review) => !labels[review.id]).map((review) => review.id),
    weeks,
    cost,
    seconds: Math.round((Date.now() - Date.parse(run.started)) / 1000),
  };
}

// The last four weeks against the four before them, or half the weeks each when there are fewer than eight.
function trend(weekly: number[]): Trend {
  const weeks = Math.min(4, Math.floor(weekly.length / 2));
  const recent = weekly.slice(-weeks).reduce((sum, n) => sum + n, 0);
  const before = weekly.slice(-2 * weeks, -weeks).reduce((sum, n) => sum + n, 0);
  const ratio = recent / before;
  const base = { recent, before, weeks };
  if (!before) return { ...base, label: recent ? "new" : "none lately", direction: recent ? "up" : "flat" };
  if (ratio >= 2) return { ...base, label: `${ratio.toFixed(1)}×`, direction: "up" };
  if (ratio >= 1.2) return { ...base, label: `+${Math.round((ratio - 1) * 100)}%`, direction: "up" };
  if (ratio <= 0.8) return { ...base, label: `−${Math.round((1 - ratio) * 100)}%`, direction: "down" };
  return { ...base, label: "steady", direction: "flat" };
}

// The Monday of every week from the first review to the last.
function weekStarts(reviews: Review[]): string[] {
  const times = reviews.flatMap((review) => (review.date ? [Date.parse(review.date)] : []));
  if (!times.length) return [];
  const first = times.reduce((min, time) => Math.min(min, time));
  const last = times.reduce((max, time) => Math.max(max, time));
  const monday = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  return Array.from({ length: Math.floor((last - monday) / (7 * DAY_MS)) + 1 }, (_, i) => new Date(monday + i * 7 * DAY_MS).toISOString().slice(0, 10));
}

function weekIndex(date: string, weeks: string[]): number {
  return Math.floor((Date.parse(date) - Date.parse(weeks[0])) / (7 * DAY_MS));
}

function reviewsCsv(reviews: Review[], themes: Theme[]): string {
  const names = new Map<string, string[]>();
  for (const theme of themes) for (const id of theme.rows) names.set(id, [...(names.get(id) ?? []), theme.name]);
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = reviews.map((review) => [review.id, review.date ?? "", review.rating ?? "", quote((names.get(review.id) ?? []).join("; ")), quote(review.text)].join(","));
  return `row,date,rating,themes,text\n${rows.join("\n")}\n`;
}

function isoDate(value: string | undefined): string | null {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

// Parses CSV, where a quoted field can hold commas, line breaks, and doubled quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      rows.push([...row, field]);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

// Runs at most `concurrency` tasks at a time, in the order they're added.
function limit(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
