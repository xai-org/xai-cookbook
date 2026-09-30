---
title: Function Calling 101
description: Define tools, let Grok decide when to call them, and feed the results back.
type: recipe
level: beginner
languages: [python]
capabilities: [function-calling]
models: [grok-4.7]
env: [XAI_API_KEY]
notebook: python/guide.ipynb
cover: cover.jpg
authors: [Zhaohan Dong]
date: 2025-01-17
---

# Function Calling 101

Define your own functions as tools, let Grok decide when to call them, and feed the results back so it can answer. The example plans a ski trip with weather data from the free US National Weather Service API.

## What you'll learn

- Describe your functions as tools that Grok can call
- Run the tool calls Grok asks for and add the results to the conversation
- Send the conversation back so Grok can give a final answer

## Run it

Open [`python/guide.ipynb`](python/guide.ipynb). If you haven't set up the repo yet, follow [Run the notebooks](../../README.md#run-the-notebooks) in the main README. It only needs your xAI API key.
