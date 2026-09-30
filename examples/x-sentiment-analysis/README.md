---
title: Real-Time Sentiment Analysis on 𝕏
description: Pull the latest posts from 𝕏 with Grok's X Search tool, filter out noise with a fast model, and score sentiment with a reasoning model.
type: guide
level: advanced
languages: [python]
capabilities: [x-data, structured-output, reasoning]
models: [grok-4.3, grok-4.7]
env: [XAI_API_KEY]
notebook: python/guide.ipynb
cover: cover.jpg
authors: [Omar Diab]
date: 2025-04-10
---

# Real-Time Sentiment Analysis on 𝕏

Combine 𝕏's real-time data with Grok to score market sentiment about Bitcoin from the latest posts. The same approach works for any topic.

## What you'll learn

- Search 𝕏 with Grok's built-in X Search tool, and use its citations to check the posts it returns
- Filter out noise with a fast model (`grok-4.3` with reasoning turned off)
- Score sentiment with a reasoning model (`grok-4.7`) and update the score as new posts come in

## Run it

Open [`python/guide.ipynb`](python/guide.ipynb). If you haven't set up the repo yet, follow [Run the notebooks](../../README.md#run-the-notebooks) in the main README.

You only need your xAI API key. X Search is billed per post it fetches, on top of the usual token costs.
