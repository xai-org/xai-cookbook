---
title: Structured Data from Fashion Images
description: Turn fashion photos into structured data, process a batch of images concurrently, and measure accuracy against labeled data.
type: guide
level: intermediate
languages: [python]
capabilities: [image-understanding, structured-output]
models: [grok-4.7]
env: [XAI_API_KEY]
notebook: python/guide.ipynb
cover: cover.jpg
authors: [Omar Diab]
date: 2025-03-03
---

# Structured Data from Fashion Images

Tag a set of fashion photos with structured attributes, then check the results against labeled data to see where the approach holds up and where it doesn't.

## What you'll learn

- Pull attributes like clothing type and color out of photos with structured outputs
- Process a batch of images concurrently with the async client
- Measure accuracy against labels, then improve the schema based on what the errors show

## Run it

Open [`python/guide.ipynb`](python/guide.ipynb). If you haven't set up the repo yet, follow [Run the notebooks](../../README.md#run-the-notebooks) in the main README. The images and labels are in [`python/data/`](python/data/).

A run sends 100 images, so it takes a few minutes and uses more credits than the other notebooks. To evaluate more or fewer, change `NUM_IMAGES` in the notebook.
