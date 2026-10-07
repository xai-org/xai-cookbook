import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { type BatchResult, type CreateParams, type ModelResponse, SpaceXAI, TimeoutError, isReasoning } from "@xai-official/sdk";
import { z } from "zod";
import { sendBatch } from "./batch.ts";
import { type Answer, type Case, type Check, type Task, answerSchema, checkAnswer, freeText, judged } from "./task.ts";

export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORTS)[number];

export const MODEL = "grok-4.7";
// The Batch API doesn't accept grok-4.7, so batch runs score grok-4.3, which has the same reasoning efforts.
export const BATCH_MODEL = "grok-4.3";
// The judge always works at the same effort, so every answer is graded the same way.
const JUDGE_EFFORT = "low";
// An effort is good enough when its accuracy is within this many points of the best one.
export const TOLERANCE = 5;
// An effort that scores lower than the best only wins when it saves at least this share of the cost, since
// costs that close are noise.
export const MIN_SAVING = 0.1;
// Requests in flight at once.
export const CONCURRENCY = 24;
// Reasoning streams in as Grok thinks, so a request that sends nothing for a minute has stalled.
const IDLE_TIMEOUT_MS = 60_000;

export type Graded = {
  effort: Effort;
  caseId: string;
  answer: Answer | null;
  error: string | null;
  checks: Check[];
  passed: boolean;
  cost: number;
  // Milliseconds, or null for batched requests, which wait in a queue.
  latency: number | null;
  reasoningTokens: number;
  // Kept for wrong answers only, to show how Grok got there.
  reasoning: string;
};
export type Summary = {
  effort: Effort;
  cases: number;
  passed: number;
  accuracy: number;
  cost: number;
  costPer1000: number;
  latency: number | null;
  reasoningTokens: number;
};
export type HeadToHead = {
  pick: Effort;
  best: Effort;
  wins: number;
  ties: number;
  losses: number;
  verdicts: Array<{ caseId: string; result: "win" | "tie" | "loss"; reasons: string[] }>;
};
export type Scorecard = {
  task: string;
  model: string;
  batch: boolean;
  summaries: Summary[];
  best: Effort;
  pick: Effort;
  headToHead: HeadToHead | null;
  cost: { answers: number; grading: number };
  seconds: number;
  graded: Graded[];
};

export type ScorecardEvents = {
  answering?: (effort: Effort, caseId: string) => void;
  graded?: (graded: Graded) => void;
  finished?: (summary: Summary) => void;
  rateLimited?: () => void;
  batch?: (id: string, done: number, total: number) => void;
  comparing?: (pick: Effort, best: Effort) => void;
};

type Answered = Omit<Graded, "effort" | "caseId" | "checks" | "passed">;
type Run = {
  client: SpaceXAI;
  task: Task;
  model: string;
  answer: z.ZodType<Answer>;
  verdicts: z.ZodType<Record<string, { reason: string; pass: boolean }>>;
  cacheKey: string;
  queue: <T>(job: () => Promise<T>) => Promise<T>;
  gradingCost: number;
  signal?: AbortSignal;
};

const JUDGE_PROMPT = `You grade answers that an assistant wrote, using a rubric. You see the instructions the assistant followed, then the input it answered, notes on what a good answer covers, and the answer's free-text fields. Other fields were checked separately, so judge only the text you're given.

For each criterion, explain your verdict in one sentence, quoting the problem if there is one, then decide whether the answer passes. Fail a criterion only for a clear problem, not for a matter of taste.`;

const COMPARE_PROMPT = `Two assistants answered the same input. Decide which answer is better overall, going by the rubric, the instructions the assistants followed, and the grading notes. Explain in one or two sentences, then answer A or B, or tie when neither is clearly better.`;

const Comparison = z.object({ reason: z.string(), better: z.enum(["A", "B", "tie"]) });

// Answers every case at every reasoning effort, grades the answers, and finds the cheapest effort within
// TOLERANCE points of the best. Reports each answer as soon as it's graded and each effort as soon as
// all of its answers are.
export async function runScorecard(task: Task, { batch = false } = {}, on: ScorecardEvents = {}, signal?: AbortSignal): Promise<Scorecard> {
  const started = Date.now();
  const model = batch ? BATCH_MODEL : MODEL;
  const client = new SpaceXAI({
    // CONCURRENCY requests at once can run into a rate limit, so a 429 gets a few more retries than the SDK's
    // default of two, each after a longer wait.
    maxRetries: 5,
    // Safe to retry, since nothing has been streamed yet when these fail.
    retryBeforeOutput: true,
    onResponse: (response) => {
      if (response.status === 429) on.rateLimited?.();
    },
  });
  const run: Run = {
    client,
    task,
    model,
    answer: answerSchema(task),
    verdicts: verdictSchema(task),
    cacheKey: `scorecard-${randomUUID()}`,
    queue: limit(CONCURRENCY),
    gradingCost: 0,
    signal,
  };

  const graded: Graded[] = [];
  const summaries: Summary[] = [];
  const record = (effort: Effort, result: Graded) => {
    graded.push(result);
    on.graded?.(result);
    const done = graded.filter((item) => item.effort === effort);
    if (done.length < task.cases.length) return;
    const summary = summarize(effort, done);
    summaries.push(summary);
    on.finished?.(summary);
  };

  if (batch) {
    const grading: Array<Promise<void>> = [];
    await answerInBatch(run, on, (effort, item, answered) => {
      grading.push(run.queue(async () => record(effort, await grade(run, item, effort, answered))));
    });
    await Promise.all(grading);
  } else {
    // Queued lowest effort first, so the efforts finish roughly in order.
    const jobs = EFFORTS.flatMap((effort) =>
      task.cases.map((item) =>
        run.queue(async () => {
          on.answering?.(effort, item.id);
          record(effort, await grade(run, item, effort, await answer(run, effort, item)));
        }),
      ),
    );
    await Promise.all(jobs);
  }

  const ordered = EFFORTS.map((effort) => summaries.find((summary) => summary.effort === effort)!);
  const { best, pick } = pickSetting(ordered);
  let headToHead: HeadToHead | null = null;
  if (pick.effort !== best.effort && task.cases.some((item) => judged(task, item))) {
    on.comparing?.(pick.effort, best.effort);
    headToHead = await compareSettings(run, pick.effort, best.effort, graded);
  }
  return {
    task: task.name,
    model,
    batch,
    summaries: ordered,
    best: best.effort,
    pick: pick.effort,
    headToHead,
    cost: { answers: graded.reduce((sum, item) => sum + item.cost, 0), grading: run.gradingCost },
    seconds: Math.round((Date.now() - started) / 1000),
    graded,
  };
}

// The cheapest effort within TOLERANCE points of the best one that saves at least MIN_SAVING, or else the best.
export function pickSetting(summaries: Summary[]): { best: Summary; pick: Summary } {
  const best = summaries.reduce((top, summary) =>
    summary.accuracy > top.accuracy || (summary.accuracy === top.accuracy && summary.cost < top.cost) ? summary : top,
  );
  const pick = summaries
    .filter((summary) => summary.accuracy >= best.accuracy - TOLERANCE && summary.cost <= best.cost * (1 - MIN_SAVING))
    .reduce((cheapest, summary) => (summary.cost < cheapest.cost ? summary : cheapest), best);
  return { best, pick };
}

export async function saveScorecard(scorecard: Scorecard): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const path = `output/${slugify(scorecard.task)}-${stamp}.json`;
  await mkdir("output", { recursive: true });
  await writeFile(path, `${JSON.stringify(scorecard, null, 2)}\n`);
  return path;
}

// The reason comes before the verdict, so the judge explains itself before it decides.
function verdictSchema(task: Task): Run["verdicts"] {
  const verdict = z.object({ reason: z.string(), pass: z.boolean() });
  return z.object(Object.fromEntries(Object.keys(task.rubric).map((id) => [id, verdict])));
}

function answerRequest(run: Run, effort: Effort, item: Case): CreateParams {
  return {
    model: run.model,
    reasoning: { effort },
    input: [
      { role: "system", content: run.task.prompt },
      { role: "user", content: item.input },
    ],
    text: { format: { type: "json_schema", name: "answer", schema: z.toJSONSchema(run.answer) } },
    // Every answer starts with the same prompt, so sending them to the same server lets it reuse the cached prompt.
    prompt_cache_key: run.cacheKey,
  };
}

// A stalled request gets one more try. The SDK only retries failures that happen before any output, and
// reasoning counts as output.
async function create(run: Run, body: CreateParams, retried = false): Promise<ModelResponse> {
  try {
    return await run.client.responses.create(body, { signal: run.signal, idleTimeout: IDLE_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof TimeoutError && !retried && !run.signal?.aborted) return create(run, body, true);
    throw error;
  }
}

async function answer(run: Run, effort: Effort, item: Case): Promise<Answered> {
  const started = performance.now();
  let response: ModelResponse;
  try {
    response = await create(run, answerRequest(run, effort, item));
  } catch (error) {
    if (run.signal?.aborted) throw error;
    return { answer: null, error: `The request failed: ${errorMessage(error)}`, cost: 0, latency: null, reasoningTokens: 0, reasoning: "" };
  }
  const usage = response.usage;
  const answered = {
    cost: usage.cost_usd ?? 0,
    latency: Math.round(performance.now() - started),
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    reasoning: response.output
      .filter(isReasoning)
      .flatMap((item) => [...(item.content ?? []), ...item.summary])
      .map((part) => part.text)
      .join("\n"),
  };
  try {
    return { ...answered, answer: response.toJson(run.answer), error: null };
  } catch (error) {
    return { ...answered, answer: null, error: `The answer didn't match the schema: ${errorMessage(error)}` };
  }
}

async function answerInBatch(run: Run, on: ScorecardEvents, onAnswer: (effort: Effort, item: Case, answered: Answered) => void): Promise<void> {
  const requests = new Map<string, { effort: Effort; item: Case }>(
    EFFORTS.flatMap((effort) => run.task.cases.map((item) => [`${effort}:${item.id}`, { effort, item }])),
  );
  const bodies = new Map([...requests].map(([id, { effort, item }]) => [id, answerRequest(run, effort, item)]));
  const seen = await sendBatch(
    run.client,
    `Scorecard: ${run.task.name}`,
    bodies,
    {
      sent: (id) => {
        for (const { effort, item } of requests.values()) on.answering?.(effort, item.id);
        on.batch?.(id, 0, requests.size);
      },
      result: (result) => {
        const { effort, item } = requests.get(result.batch_request_id)!;
        onAnswer(effort, item, fromBatchResult(run, result));
      },
      progress: (id, done, total) => on.batch?.(id, done, total),
    },
    run.signal,
  );
  for (const [id, { effort, item }] of requests) {
    if (!seen.has(id)) onAnswer(effort, item, { answer: null, error: "The batch returned no result", cost: 0, latency: null, reasoningTokens: 0, reasoning: "" });
  }
}

// Batch results come back in the Chat Completions format, which the SDK doesn't wrap in a response
// object, so there's no toJson() here and the answer is validated with the schema directly.
function fromBatchResult(run: Run, result: BatchResult): Answered {
  const failed = { answer: null, cost: 0, latency: null, reasoningTokens: 0, reasoning: "" };
  const outcome = result.batch_result;
  if ("error" in outcome) return { ...failed, error: `The request failed: ${outcome.error}` };
  if (typeof outcome.response !== "object" || !("chat_get_completion" in outcome.response)) {
    return { ...failed, error: "The batch returned something other than an answer" };
  }
  const completion = outcome.response.chat_get_completion;
  const message = completion.choices[0]?.message;
  const usage = completion.usage;
  const answered = {
    // Batch results report their cost in ticks, ten billion to the dollar.
    cost: (usage?.cost_in_usd_ticks ?? 0) / 1e10,
    latency: null,
    reasoningTokens: usage?.completion_tokens_details.reasoning_tokens ?? 0,
    reasoning: message?.reasoning_content ?? "",
  };
  let json: unknown;
  try {
    json = JSON.parse(message?.content ?? "");
  } catch {
    return { ...answered, answer: null, error: "The answer wasn't valid JSON" };
  }
  const parsed = run.answer.safeParse(json);
  if (!parsed.success) return { ...answered, answer: null, error: `The answer didn't match the schema: ${z.prettifyError(parsed.error)}` };
  return { ...answered, answer: parsed.data, error: null };
}

async function grade(run: Run, item: Case, effort: Effort, answered: Answered): Promise<Graded> {
  const checks: Check[] = answered.answer ? checkAnswer(run.task, item, answered.answer) : [{ name: "answer", by: "code", pass: false, note: answered.error ?? "" }];
  // An answer that fails a code check is wrong whatever the judge thinks, so it's never sent to the judge.
  if (answered.answer && checks.every((check) => check.pass) && judged(run.task, item)) {
    checks.push(...(await judge(run, item, answered.answer)));
  }
  const passed = checks.every((check) => check.pass);
  return { effort, caseId: item.id, ...answered, reasoning: passed ? "" : answered.reasoning, checks, passed };
}

// The judge sees the answer but never which effort wrote it.
async function judge(run: Run, item: Case, answer: Answer): Promise<Check[]> {
  try {
    const response = await create(run, {
      model: MODEL,
      reasoning: { effort: JUDGE_EFFORT },
      input: [
        { role: "system", content: `${JUDGE_PROMPT}\n\n${background(run.task)}` },
        { role: "user", content: `Input:\n${item.input}\n\nGrading notes:\n${item.notes ?? "None"}\n\nAnswer:\n${freeText(run.task, item, answer)}` },
      ],
      text: { format: { type: "json_schema", name: "verdicts", schema: z.toJSONSchema(run.verdicts) } },
      prompt_cache_key: `${run.cacheKey}-judge`,
    });
    run.gradingCost += response.usage.cost_usd ?? 0;
    return Object.entries(response.toJson(run.verdicts)).map(([name, { reason, pass }]) => ({ name, by: "judge" as const, pass, note: reason }));
  } catch (error) {
    if (run.signal?.aborted) throw error;
    return [{ name: "judge", by: "judge", pass: false, note: `The judge couldn't grade it: ${errorMessage(error)}` }];
  }
}

// Compares the free text of the picked effort's answers with the best effort's, case by case.
async function compareSettings(run: Run, pick: Effort, best: Effort, graded: Graded[]): Promise<HeadToHead> {
  const answers = (effort: Effort) => new Map(graded.flatMap((item) => (item.effort === effort && item.answer ? [[item.caseId, item.answer] as const] : [])));
  const picked = answers(pick);
  const top = answers(best);
  const cases = run.task.cases.filter((item) => picked.has(item.id) && top.has(item.id) && judged(run.task, item));
  const verdicts = await Promise.all(
    cases.map(async (item) => {
      const [mine, theirs] = [freeText(run.task, item, picked.get(item.id)!), freeText(run.task, item, top.get(item.id)!)];
      // Judges tend to favor one position, so each pair is judged in both orders. A win only counts when
      // both orders agree, and anything else is a tie.
      const [first, second] = await Promise.all([
        run.queue(() => compare(run, item, mine, theirs)),
        run.queue(() => compare(run, item, theirs, mine)),
      ]);
      const result = first.better === "A" && second.better === "B" ? "win" : first.better === "B" && second.better === "A" ? "loss" : "tie";
      return { caseId: item.id, result, reasons: [first.reason, second.reason] } satisfies HeadToHead["verdicts"][number];
    }),
  );
  const count = (result: string) => verdicts.filter((verdict) => verdict.result === result).length;
  return { pick, best, wins: count("win"), ties: count("tie"), losses: count("loss"), verdicts };
}

async function compare(run: Run, item: Case, a: string, b: string): Promise<z.output<typeof Comparison>> {
  try {
    const response = await create(run, {
      model: MODEL,
      reasoning: { effort: JUDGE_EFFORT },
      input: [
        { role: "system", content: `${COMPARE_PROMPT}\n\n${background(run.task)}` },
        { role: "user", content: `Input:\n${item.input}\n\nGrading notes:\n${item.notes ?? "None"}\n\nAnswer A:\n${a}\n\nAnswer B:\n${b}` },
      ],
      text: { format: { type: "json_schema", name: "comparison", schema: z.toJSONSchema(Comparison) } },
      prompt_cache_key: `${run.cacheKey}-compare`,
    });
    run.gradingCost += response.usage.cost_usd ?? 0;
    return response.toJson(Comparison);
  } catch (error) {
    if (run.signal?.aborted) throw error;
    return { reason: `The comparison failed: ${errorMessage(error)}`, better: "tie" };
  }
}

// The rubric and the instructions come first and never change, so every grading request shares a cached prefix.
function background(task: Task): string {
  const rubric = Object.entries(task.rubric).map(([id, description]) => `- ${id}: ${description}`);
  return `Rubric:\n${rubric.join("\n")}\n\nThe instructions the assistant followed:\n${task.prompt}`;
}

function summarize(effort: Effort, graded: Graded[]): Summary {
  const passed = graded.filter((item) => item.passed).length;
  const cost = graded.reduce((sum, item) => sum + item.cost, 0);
  return {
    effort,
    cases: graded.length,
    passed,
    accuracy: (passed / graded.length) * 100,
    cost,
    costPer1000: (cost / graded.length) * 1000,
    latency: median(graded.flatMap((item) => (item.latency === null ? [] : [item.latency]))),
    reasoningTokens: Math.round(graded.reduce((sum, item) => sum + item.reasoningTokens, 0) / graded.length),
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scorecard";
}

// Runs at most `concurrency` jobs at a time, in the order they're added.
function limit(concurrency: number): Run["queue"] {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (job) => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
