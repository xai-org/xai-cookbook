---
title: Quickstart
description: Send your first requests with the Responses API, stream replies, hold a conversation, and get structured output.
type: recipe
level: beginner
order: 1
languages: [python]
capabilities: [chat, streaming, structured-output, reasoning]
models: [grok-4.7, grok-4.3]
env: [XAI_API_KEY]
notebook: python/guide.ipynb
cover: cover.jpg
authors: [Eric Zakariasson]
date: 2026-09-30
---

# Quickstart

The basics of the xAI API in one short notebook, using the Responses API through the OpenAI Python SDK.

## What you'll learn

- Send a request and read the reply
- Give Grok instructions with a system message
- Stream the reply as it's written
- Hold a conversation with `previous_response_id`
- Get structured output back as a Pydantic model
- Choose how much Grok reasons before it answers

## Run it

Open [`python/guide.ipynb`](python/guide.ipynb). If you haven't set up the repo yet, follow [Run the notebooks](../../README.md#run-the-notebooks) in the main README. It only needs your xAI API key.
