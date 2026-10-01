---
title: Storyboard to Short Film
description: Turn a one-line premise into a four-shot short film with Grok Imagine keyframes, image-to-video, and narration.
type: app
level: intermediate
languages: [typescript]
capabilities: [structured-output, image-generation, video-generation, text-to-speech]
models: [grok-4.7, grok-imagine-image-2.0, grok-imagine-video-1.5]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Storyboard to Short Film

Give it a premise, and it plans four shots, draws a keyframe for each, animates them into eight-second clips, and narrates the story.

## What you'll learn

- Plan a shot list as structured output
- Keep a character consistent across images by editing the first keyframe instead of generating each one from scratch
- Animate still images with image-to-video, running the jobs in parallel and waiting for them to finish
- Add narration with text-to-speech

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`. If [ffmpeg](https://ffmpeg.org) is installed, the script also joins the shots into one film with the narration mixed in.

```bash
cd examples/storyboard-to-film/typescript
npm install
npm start -- "A lighthouse keeper's cat on the night of the big storm"
```

Without a premise, it films a paper boat's journey through a rainy city. Everything is saved to `output/<title>/`. Open `index.html` to watch the shots, or play `film.mp4` if you have ffmpeg. A run makes four images and four videos, takes a few minutes, and cost about $5 when we ran it. The script prints the image and video cost at the end.

## How it works

1. `planStoryboard()` asks `grok-4.7` for a title, a visual style, and four shots, each with a scene, a camera move, and a line of narration.
2. `drawKeyframes()` generates the first keyframe with `client.images.generate()`, then makes the other three with `client.images.edit()`, asking it to keep the subject and style of the first. That's what keeps the main character looking the same from shot to shot.
3. `animate()` starts a `grok-imagine-video-1.5` job for each keyframe with `client.videos.generate()` and waits for it with `client.videos.wait()`. The videos come with their own sound.
4. `narrate()` records each line with `client.voice.speak()` while the videos render.
5. `assembleFilm()` uses ffmpeg to lay each line of narration over its shot, with the shot's own sound turned down, and joins the shots.
