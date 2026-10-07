---
title: Reasoning Effort Evals
seo_title: "LLM Evals: Find the Right Reasoning Effort with the Grok API"
description: Run a prompt's test cases at every reasoning effort, grade the answers with code checks and a judge, and find the cheapest effort that's still good enough.
type: app
level: intermediate
languages: [typescript]
capabilities: [reasoning, structured-output, batch]
models: [grok-4.7, grok-4.3]
env: [XAI_API_KEY]
icon: sliders
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Reasoning Effort Evals

This app builds an eval harness with the Grok API that compares every reasoning effort on your own test cases. It's a quick way to stop paying for reasoning a task doesn't need.

Give it a prompt and a set of test cases with expected answers. It runs every case through `grok-4.7` at low, medium, high, and xhigh reasoning effort, grades each answer, and plots accuracy against cost. Then it names the cheapest effort within 5 points of the best one. It runs as a small web app or in your terminal, and comes with a sample task: 30 support tickets for a made-up invoicing app, where Grok picks a category and a priority and writes a reply.

More reasoning doesn't always pay off. On the sample's short tickets, medium, high, and xhigh used about the same number of reasoning tokens, around 600 per answer, so they cost about the same. Low used about 140 and cost half as much. In our runs, every effort scored between 87% and 93%, and which one scored best changed from run to run.

## What you'll learn

- Grade with code checks first, for the fields that have a right answer, and send only the answers that pass to an LLM judge, which grades the free text against a rubric and returns its verdicts as structured output
- Keep the judge fair: it never sees which effort wrote an answer, and when it compares two answers, it sees them in both orders
- Build one Zod schema per task and use it twice: as the JSON Schema in the request, and to validate the answer with `toJson(schema)`
- Run many requests with a concurrency limit, and let the SDK retry rate-limited requests with backoff
- Measure each request's cost from `usage` and its latency, and compare efforts by what 1,000 answers cost
- Send a whole run through the Batch API, which doesn't count toward rate limits

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/reasoning-effort-evals/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Run the sample**. The page works like an eval dashboard. Each effort gets a row of cells, one per test case, that pulse while Grok answers and turn green or red as each answer is graded. The latest answers stream in on the right, and each effort's point moves into place on the accuracy and cost chart as its answers come in, then turns solid when the last one is graded. When every effort is done, the line at the top names the effort to use, and the chart shades the band within 5 points of the best. Click a point, a row of the scorecard, or a cell to see the answers that effort got wrong: the ticket, what the code checks found, why the judge marked the reply down, and Grok's reasoning. Click **Stop** or close the page to cancel the run.

To score your own prompt, click **Edit prompt and cases**, paste your prompt, and replace the fields, rubric, and cases with your own. The page checks them before it runs. From the terminal, pass a task file instead. Without one, it runs the sample:

```bash
npm start -- your-task.json
```

Both versions save every answer, check, cost, and latency to `output/<task>-<time>.json`. A run of the sample makes 120 answers and up to about 180 grading requests. It took 4 to 6 minutes and cost about $1.05 each time we ran it, half for the answers and half for grading. At the end, the page and the terminal show what the run cost. Latency includes any time spent waiting out rate limits.

### Your own task

A task is a JSON file like [`sample-task.json`](typescript/sample-task.json):

```json
{
  "name": "Support ticket triage",
  "prompt": "You triage support tickets for Fernbill...",
  "fields": {
    "category": { "options": ["billing", "payments", "bug"] },
    "priority": { "options": ["urgent", "high", "normal", "low"] },
    "reply": { "max_words": 80 }
  },
  "rubric": {
    "accurate": "Everything it says about Fernbill matches the facts in the instructions."
  },
  "cases": [
    {
      "id": "t01",
      "input": "Plan: Pro\n\nI was charged twice this month.",
      "expected": { "category": "billing", "priority": "high" },
      "notes": "Says the duplicate charge will be refunded within 5 to 10 business days."
    }
  ]
}
```

- `prompt` is the system prompt. It can be one string or an array of lines.
- `fields` is the answer Grok returns. A field with `options` is a choice, and any other field is free text. `max_words` caps a field's length.
- `expected` holds the right answer for each field that has one. Code checks these.
- `rubric` lists what the judge checks in the free text, and `notes` tells it what a good answer to that case covers. Leave out the rubric to grade with code checks only.

### Batch mode

Switch to **grok-4.3 Batch API** on the page, or pass `--batch` in the terminal, to send every answer request in one batch:

```bash
npm start -- --batch
```

Batch requests don't count toward your rate limits, which matters once a run has thousands of requests. The Batch API doesn't accept `grok-4.7` yet, so batch mode scores `grok-4.3`, which has the same four reasoning efforts and costs less, especially in a batch, since [batch requests are discounted](https://docs.x.ai/developers/pricing#batch-api-pricing). Our test batches finished in about two minutes, but the API only promises that most batches finish within 24 hours. Answers are graded as they come back, and the judge still runs in real time. Batched requests wait in a queue, so batch mode doesn't measure latency. Stopping a batch run cancels the batch, so requests that haven't run aren't billed.

## How it works

The task format is in `src/task.ts`, and the run is in `src/scorecard.ts`. `runScorecard()` runs these steps and reports each answer as it's graded and each effort as soon as all of its answers are, so the web app and the terminal app show the same progress in their own way:

1. `parseTask()` validates the task with Zod and checks that every expected answer is one of its field's options. Zod is the one dependency besides the SDK: Node has no schema validator built in, and the same library builds the answer schema in the next step.
2. `answerSchema()` turns the task's fields into a Zod object, with `z.enum()` for fields with options. `z.toJSONSchema()` turns it into the JSON Schema for `text.format`, and `response.toJson(schema)` checks each answer against it and types the result, so a malformed answer counts as wrong instead of crashing the run.
3. Every case is queued at every effort, lowest effort first, and `limit()` keeps 24 requests in flight. Rate limits apply per team, and 24 requests at once can reach them. The SDK retries a `429` with backoff on its own, and the client is created with `maxRetries: 5` instead of the default 2. Its `onResponse` hook counts the retries, and the page shows them. The answer requests share a `prompt_cache_key`, so they go to the same server and reuse the cached prompt.
4. `create()` sends each request with a one-minute `idleTimeout`. Reasoning streams in as Grok thinks, so a request that goes quiet that long has stalled, and it gets one more try. The SDK doesn't retry it on its own, because it only retries failures that happen before any output.
5. `grade()` runs the code checks first. `checkAnswer()` compares each field that has an expected answer and counts the words in fields with `max_words`. Only an answer that passes them all goes to `judge()`, since an answer with the wrong category is wrong whatever the judge thinks of the reply, and judge calls cost money.
6. `judge()` sends the rubric, the instructions Grok followed, the case, its notes, and the free text to `grok-4.7` at low effort, and gets back a verdict for each criterion as structured output. The schema puts each reason before its verdict, so the judge explains itself before it decides. It never sees which effort wrote the answer, and the rubric and instructions come first, so every grading request shares a cached prefix. An answer is correct when every check passes.
7. Each request's cost comes from `usage.cost_usd` and its latency from a timer around the request. `pickSetting()` takes the best accuracy and picks the cheapest effort within `TOLERANCE`, 5 points, of it. With 30 cases, each case is worth more than 3 points, so a case or two is noise. Costs are noisy too, so an effort that scores lower than the best only wins when it costs at least `MIN_SAVING`, 10%, less.
8. When the pick isn't the best effort, `compareSettings()` puts their free-text answers head to head. Judges tend to favor one position, so it asks about each pair twice with the order swapped, and counts a win only when both orders agree.

In batch mode, `sendBatch()` in `src/batch.ts` creates a batch with `client.batches.create()`, adds every answer request with `client.batches.requests.add()`, and polls `client.batches.results()` every 10 seconds, handing over each answer as it arrives so it can be graded while the rest wait. Batch results come back in the Chat Completions format, which the SDK returns as plain JSON rather than a response object, so `fromBatchResult()` validates them with the Zod schema directly. Each result reports its cost in `cost_in_usd_ticks`, ten billion to the dollar.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first posts the task to `/api/tasks` and then opens `/api/scorecard` with the id it gets back. The server runs `runScorecard()`, streams each step to the page as a server-sent event, and serves the results file the run saved, and no other file. It passes an `AbortSignal` to every request and aborts it when the page closes. `public/index.html` is plain HTML and JavaScript that shows those events as a dashboard. `src/index.ts` does the same work in the terminal and prints the scorecard and the answers the picked effort got wrong.
