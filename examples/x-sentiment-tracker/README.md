---
title: 𝕏 Sentiment Tracker
description: Score the sentiment about any topic from live 𝕏 posts with Grok's X Search tool, and watch the searches and Grok's reasoning stream into a small web app.
type: app
level: intermediate
languages: [typescript]
capabilities: [x-data, structured-output, reasoning, streaming]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# 𝕏 Sentiment Tracker

Give it a topic, like a company, a product, or an event, and it searches 𝕏 for popular posts about it from the last 10 days, filters out the noise, and scores the sentiment. It runs as a small web app or in your terminal, and shows the searches, the posts it keeps, and Grok's reasoning as they happen. It follows the same approach as the [𝕏 sentiment notebook](../x-sentiment-analysis/).

## What you'll learn

- Search 𝕏 with the built-in X Search tool and 𝕏's search operators
- Run one search per day in parallel to collect more posts than a single search returns
- Use citations to keep only the posts that X Search actually returned
- Show server-side searches and reasoning as they happen with the SDK's stream events
- Match the reasoning effort to the job: low for searching and filtering, the default for scoring
- Stream progress from a Node server to a web page with server-sent events, and cancel the work when the page closes

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/x-sentiment-tracker/typescript
npm install
npm run web
```

Open http://localhost:3000, enter a topic, and click **Check sentiment**. The page shows the searches as they run, the posts Grok keeps, and its reasoning, then the score on a scale from -1 (negative) to +1 (positive), with the posts that influenced it most. Click **Stop** or close the page to cancel.

To check a topic from the terminal instead, pass it as an argument. It defaults to SpaceX.

```bash
npm start -- SpaceX
```

The topic goes into the search query as is, so you can use 𝕏's search operators in it, like `Starship OR Starlink`.

A search returns at most 10 posts, so the app runs one search for each of the last 10 days, all at the same time, and collects up to 100 posts. A run takes about a minute and a half and costs about 80 cents, most of it for X Search, which is billed at $5 per 1,000 posts it fetches, on top of token costs. To search fewer days, change `DAYS` at the top of `src/sentiment.ts`.

## How it works

The shared code is in `src/sentiment.ts`. `analyze()` runs these steps and reports each one through callbacks, so the web app and the terminal app show the same progress in their own way:

1. `findPosts()` streams a `grok-4.7` request with `xSearch()` limited to one day, asking for that day's most popular posts as JSON. The `server_tool_call` event reports the search as it runs, and the `citation` event collects the posts Grok cites, which is how the app drops any post that X Search didn't return. `analyze()` runs it for each of the last 10 days at once, removes duplicates, and skips a day whose search fails.
2. `filterPosts()` keeps the posts that show how people feel about the topic, using a low reasoning effort.
3. `scoreSentiment()` scores the posts it kept with the default effort and reports Grok's reasoning as it streams in.

`src/server.ts` runs `analyze()` for the topic from the page and sends each step to it as a server-sent event. It passes an `AbortSignal` to every request, so closing the page or clicking **Stop** cancels whatever is running. `public/index.html` is plain HTML and JavaScript that shows those events: each day's search, the posts Grok kept, its reasoning, and the score with the posts that influenced it most. `src/index.ts` prints the same steps in the terminal.
