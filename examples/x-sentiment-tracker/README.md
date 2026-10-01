---
title: 𝕏 Sentiment Tracker
description: Track sentiment about any topic from live 𝕏 posts with Grok's X Search tool, and watch the searches and Grok's reasoning stream into a small web app.
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

Give it a topic, like a company, a product, or an event, and it searches 𝕏 for recent posts about it every minute, filters out the noise, and keeps a running sentiment score. It runs as a small web app or in your terminal, and shows each search, the posts it keeps, and Grok's reasoning as they happen. It follows the same approach as the [𝕏 sentiment notebook](../x-sentiment-analysis/).

## What you'll learn

- Search 𝕏 with the built-in X Search tool and 𝕏's search operators
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

Open http://localhost:3000, enter a topic, and click **Start tracking**. The page shows each search as it runs, the posts Grok keeps, and its reasoning, then the score on a scale from -1 (negative) to +1 (positive). Click **Stop** or close the page to stop tracking.

To track a topic from the terminal instead, pass it as an argument. It defaults to SpaceX.

```bash
npm start -- SpaceX
```

The topic goes into the search query as is, so you can use 𝕏's search operators in it, like `Starship OR Starlink`.

It runs three rounds a minute apart. To change that, edit `ROUNDS` and `INTERVAL_SECONDS` at the top of `src/sentiment.ts`. X Search is billed per post it fetches, on top of token costs. Each search fetches about 10 posts, so a run costs around 20 cents.

## How it works

The shared code is in `src/sentiment.ts`. `track()` runs the rounds and reports each step through callbacks, so the web app and the terminal app show the same progress in their own way:

1. `findPosts()` streams a `grok-4.7` request with `xSearch()` and a JSON schema for the posts. The `server_tool_call` event reports each search as it runs, and the `citation` event collects the posts Grok cites, which is how the app drops any post that X Search didn't return.
2. `filterPosts()` keeps the posts that say something about sentiment, using a low reasoning effort.
3. `scoreSentiment()` scores the most recent high-signal posts with the default effort and reports Grok's reasoning as it streams in.
4. Each round skips posts it has already seen. If it keeps any new posts, it rescores the 20 most recent high-signal posts. Then it waits a minute before the next round.

`src/server.ts` runs `track()` for the topic from the page and sends each step to it as a server-sent event. It passes an `AbortSignal` to every request and to the wait between rounds, so closing the page or clicking **Stop** cancels whatever is running. `public/index.html` is plain HTML and JavaScript that shows those events: the searches, the posts Grok kept, its reasoning, and the score, with a chart of the score after each round. `src/index.ts` prints the same steps in the terminal.
