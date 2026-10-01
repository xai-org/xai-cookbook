---
title: 𝕏 Sentiment Tracker
description: Track sentiment about any topic from live 𝕏 posts with Grok's X Search tool, and watch the searches and Grok's reasoning stream into your terminal.
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

A terminal app that searches 𝕏 for recent posts about a topic every minute, filters out the noise, and keeps a running sentiment score. It's the TypeScript version of the [𝕏 sentiment notebook](../x-sentiment-analysis/).

## What you'll learn

- Search 𝕏 with the built-in X Search tool and 𝕏's search operators
- Use citations to keep only the posts that X Search actually returned
- Show server-side searches and reasoning as they happen with the SDK's stream events
- Match the reasoning effort to the job: low for searching and filtering, the default for scoring

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/x-sentiment-tracker/typescript
npm install
npm start -- Bitcoin
```

Pass the topic to track, like a coin, a stock, or a company. It defaults to Bitcoin. The topic goes into the search query as is, so you can use 𝕏's search operators in it, like `npm start -- BTC OR Bitcoin`.

It runs three rounds a minute apart. To change that, edit `ROUNDS` and `INTERVAL_SECONDS` at the top of `src/index.ts`. X Search is billed per post it fetches, on top of token costs. Each search fetches about 10 posts, so a run costs around 20 cents.

## How it works

1. `findPosts()` streams a `grok-4.7` request with `xSearch()` and a JSON schema for the posts. The `server_tool_call` event prints each search as it runs, and the `citation` event collects the posts Grok cites, which is how the app drops any post that X Search didn't return.
2. `filterPosts()` keeps the posts that say something about sentiment, using a low reasoning effort.
3. `scoreSentiment()` scores the most recent high-signal posts with the default effort and prints Grok's reasoning as it streams in.
4. Each round skips posts it has already seen. If it keeps any new posts, it rescores the 20 most recent high-signal posts.
