---
title: Real-Time Sentiment Analysis on 𝕏
description: Stream posts from 𝕏, filter out noise with a fast model, and score sentiment with a reasoning model.
type: guide
level: advanced
languages: [python]
capabilities: [x-data, structured-output, reasoning]
models: [grok-4.3, grok-4.7]
env: [XAI_API_KEY, X_API_KEY, X_API_SECRET]
notebook: python/guide.ipynb
cover: cover.jpg
authors: [Omar Diab]
date: 2025-04-10
---

# Real-Time Sentiment Analysis on 𝕏

Combine 𝕏's real-time data with Grok to score market sentiment about Bitcoin as posts come in. The same approach works for any topic.

## What you'll learn

- Stream posts that match a rule from 𝕏's Filtered Stream API
- Filter out noise with a fast model (`grok-4.3` with reasoning turned off)
- Score sentiment with a reasoning model (`grok-4.7`) and update the score as new posts arrive

## Run it

Open [`python/guide.ipynb`](python/guide.ipynb). If you haven't set up the repo yet, follow [Run the notebooks](../../README.md#run-the-notebooks) in the main README.

Besides your xAI API key, this notebook needs an 𝕏 API key and secret with access to the Filtered Stream API. Add them to `.env` as `X_API_KEY` and `X_API_SECRET`.
