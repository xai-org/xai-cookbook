---
title: Reviews to Themes
description: Turn a thousand app reviews into ranked themes with counts, trends, and quotes by labeling every review in one Batch API job, and watch it happen in a small web app.
type: app
level: intermediate
languages: [typescript]
capabilities: [batch, files, structured-output, streaming, reasoning]
models: [grok-4.7, grok-4.3, grok-4.20-0309-non-reasoning, grok-4.20-0309-reasoning]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Reviews to Themes

Give it a CSV of app reviews or support tickets, and it finds the themes in them: what people complain about, ask for, and like. For each theme you get how many reviews mention it, whether that's going up or down, and quotes that link back to the rows behind it. Grok reads a sample to find candidate themes, labels every review against them with the Batch API, then merges and names the themes. It runs as a small web app or in your terminal.

## What you'll learn

- Map-reduce over more text than fits in one request: find candidate themes in a sample, label every review in small requests, then count the labels and merge the themes
- Write requests to a JSONL file, upload it with `client.files.upload()`, and start a batch from it with `client.batches.create({ input_file_id })`
- Poll a batch and read each result as soon as it's ready, instead of waiting for the whole batch
- Pick up a batch after a crash or a closed page from nothing more than its saved ID, and cancel one with `client.batches.cancel()`
- Choose between a batch and live requests, and why the bigger win of a batch is that it doesn't count toward rate limits
- Write a JSON schema with one property per review and an `enum` of theme IDs, so every review gets labels and every label is a real theme, and share its parts with `$defs` to cut the input tokens
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/reviews-to-themes/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Run on the sample**, or choose your own CSV first. The page works like a feedback analytics dashboard. The three steps sit at the top, over a progress bar that fills as the batch labels the reviews. On the left, the candidate themes appear as Grok finds them and count up as the labels come in. On the right you see Grok's reasoning, then each review as it's labeled, with the words that matched highlighted. When it's done, the themes are ranked by how many reviews mention them, each with its trend, its average rating, and quotes. Click a theme to see its reviews week by week and every row behind it, and click a quote to jump to its row. Click **Stop** to cancel the run and its batch.

`sample-reviews.csv` holds 993 made-up reviews of a budgeting app over 12 weeks, with themes planted in them: bank sync breaking more and more often, a price increase, a new planner that people like and a crash that came with it, and a login problem that got fixed. `src/make-sample.ts` decided how many reviews each theme gets each week, so you can check what the app finds, and had Grok write them. To make a new sample, run `node --env-file-if-exists=../../../.env --experimental-strip-types src/make-sample.ts`.

Your own CSV needs a column of text named `text`, `review`, `body`, `comment`, `content`, `message`, or `feedback`. A `date` column adds trends, and a `rating`, `stars`, or `score` column adds average ratings. Node has no CSV parser built in, so `src/themes.ts` has a small one.

To find the themes from the terminal instead, pass a CSV. Without one, it uses the sample.

```bash
npm start -- reviews.csv
```

That saves the themes to `output/<name>/` as `themes.md` and `themes.json`, with every review and its themes in `reviews.csv`. Add `--model` to choose the model that labels the reviews, `--live` to send the requests yourself instead of in a batch, and `--new` to start over.

The batch runs at SpaceXAI, not in your process, so it keeps going when your process stops. Its ID is saved to `run.json` in the output folder as soon as it's created. If the terminal version stops while it waits, run the same command again, and it picks up the batch where it left off. In the web app, closing the page stops the server from waiting, and when you open the page again it offers to pick up the batch.

Labeling is the bulk of the work: 40 requests of 25 reviews for the sample, or 400 for 10,000 reviews. The app sends them in a batch with `grok-4.3` by default, and you can choose `grok-4.20-0309-non-reasoning` or `grok-4.20-0309-reasoning` instead. [Batch requests are discounted](https://docs.x.ai/developers/pricing#batch-api-pricing) for those three models, but the bigger win is that they don't count toward your rate limits. Live requests count toward your team's limit on tokens per minute, so thousands of them get 429 errors and have to wait.

`grok-4.7` is the most capable model, but it doesn't take batch requests: a batch with one in it is cancelled with "Model grok-4.7 is not supported for batch processing". Choose it, and the app sends the requests live, eight at a time. Live mode works with the other models too. Finding the candidate themes and naming the final ones are one request each, so they always run live, with `grok-4.7`.

A batch can take up to 24 hours, but every batch we ran finished in 40 seconds or less. A run on the sample took one to three minutes and costs about 23 cents at the published prices, almost all of it to label the reviews. The page and the terminal show what each run cost, from the costs the API reports.

## How it works

The shared code is in `src/themes.ts`. `analyze()` runs a map-reduce over the reviews, too many for one request, and reports each step as it happens:

1. `findCandidates()` sends `grok-4.7` 150 reviews spread across the whole period and streams back candidate themes as structured output, each with an ID, a name, and a sentence on what counts. The stream's `json` event reports each theme as soon as the next one starts, and the `reasoning` event shows Grok's reasoning. A low reasoning effort is plenty for a list of themes.
2. `labelRequest()` builds one request for each 25 reviews. Its JSON schema has a required property for each review, so none can be skipped. Each one lists the themes the review mentions, from an `enum` of the candidates' IDs, with the words that show each theme. The schema counts toward the input tokens, so the properties share one definition through `$defs` and `$ref`, which cut each request from about 3,900 input tokens to 1,600.
3. `submitBatch()` writes the requests to a JSONL file, one per line with a `custom_id` and the `/v1/responses` body, uploads it with `client.files.upload()`, and starts a batch from it with `client.batches.create({ input_file_id })`. The file goes to the API as it is, without the SDK's defaults, so each body sets `store: false` itself.
4. `waitForBatch()` polls `client.batches.get()` every three seconds. Whenever more requests have finished, it reads the new results with `client.batches.results()`. Each result holds the labels as JSON and its cost in `cost_in_usd_ticks`, ten billion to the dollar. The SDK's `client.batches.wait()` waits until no requests are pending, but a batch made from a file has no requests at all for its first few seconds, while it reads the file, so `waitForBatch()` also waits until the batch has as many requests as the file. `labelLive()` sends the same requests itself instead, eight at a time.
5. `nameThemes()` is the reduce step. With every review labeled, it sends `grok-4.7` each candidate with its number of reviews and some quotes, and Grok merges candidates that turned out to be the same theme and names the final ones. `summarize()` counts each theme's reviews week by week, compares the last four weeks with the four before, and picks quotes from the newest reviews that appear in them word for word.

`resume()` loads `run.json` and runs the last two steps for a saved batch, and `cancel()` stops one with `client.batches.cancel()`. Every API call goes through the SDK.

`src/server.ts` runs `analyze()` or `resume()` for the page and sends each step to it as a server-sent event. `EventSource` can only make GET requests, so the page first uploads a CSV to `/api/uploads` and then opens `/api/run` with the ID it gets back. The server passes an `AbortSignal` to every API call and aborts it when the page closes, but leaves the batch running so the page can pick it up later. **Stop** also posts to `/api/stop`, which cancels the batch. The server serves only the files a run saved. `public/index.html` is plain HTML and JavaScript that shows those events as a dashboard, and keeps the run's ID in `localStorage` so it can offer to pick up the batch. `src/index.ts` does the same work in the terminal.
