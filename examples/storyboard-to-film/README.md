---
title: Storyboard to Short Film
seo_title: "AI Short Film Generator: Premise to Video with Grok Imagine"
description: Turn a one-line premise into a four-shot short film with Grok Imagine keyframes, image-to-video, and narration, and watch it being made in a small web app.
type: app
level: intermediate
languages: [typescript]
capabilities: [structured-output, streaming, image-generation, video-generation, text-to-speech]
models: [grok-4.7, grok-imagine-image-2.0, grok-imagine-video-1.5]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Storyboard to Short Film

This app builds an AI short film generator with the Grok API and Grok Imagine that turns a one-line premise into a narrated four-shot film. It shows how to plan shots as structured output, keep a character consistent across keyframes, and animate them with image-to-video.

Give it a premise, and it plans four shots, draws a keyframe for each, animates them into eight-second clips, and narrates the story. A small web app shows each step as it happens, from Grok's reasoning to the finished film.

## What you'll learn

- Plan a shot list as structured output, and stream Grok's reasoning while it plans
- Keep a character consistent across images by editing the first keyframe, while giving each shot its own scene and camera angle
- Animate still images with image-to-video, running the jobs in parallel and waiting for them to finish
- Add narration with text-to-speech
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`. If [ffmpeg](https://ffmpeg.org) is installed, the app also joins the shots into one film with the narration mixed in.

```bash
cd examples/storyboard-to-film/typescript
npm install
npm run web
```

Open http://localhost:3000, type a premise or pick one, and click **Make film**. The page works like a video editor. The plan fills the panel on the left, with Grok's reasoning while it writes it. Each shot fills its slot on the timeline as its keyframe is drawn and its video renders, and its line of narration fills the voice track below. Click a shot to watch it in the monitor. When the shots are joined, the film plays in the monitor, and clicking the timeline jumps through it.

To make a film from the terminal instead, pass a premise:

```bash
npm start -- "A lighthouse keeper's cat on the night of the big storm"
```

Without a premise, it films a paper boat's journey through a rainy city. Both save everything to `output/<title>/`, and the terminal version also writes an `index.html` there that plays the shots. A run makes four images and four videos, takes a few minutes, and cost about $5 when we ran it. Both show the image and video cost at the end.

## How it works

The shared code is in `src/storyboard.ts`:

1. `planStoryboard()` streams a title, a visual style, and four shots from `grok-4.7` as structured output, each shot with a scene, a camera move, and a line of narration. Each scene has its own setting and camera angle. It reports Grok's reasoning as it arrives.
2. `drawKeyframes()` generates the first keyframe with `client.images.generate()`, then makes the other three with `client.images.edit()`, using the first only as a reference for the subject and style and asking for a new scene from a new camera angle. Editing is what keeps the main character looking the same from shot to shot. Asked only to keep the subject, an edit also keeps the composition, and the shots look like versions of one picture. It reports each keyframe as soon as it's drawn.
3. `animate()` starts a `grok-imagine-video-1.5` job for a keyframe with `client.videos.generate()` and waits for it with `client.videos.wait()`. The videos come with their own sound.
4. `narrate()` records a line of narration with `client.voice.speak()`.
5. `assembleFilm()` uses ffmpeg to lay each line of narration over its shot, with the shot's own sound turned down, and joins the shots.

The functions take an `AbortSignal`, which they pass to the SDK and to ffmpeg, so a caller can stop them partway. `drawKeyframes()` and `animate()` also return what each image and video cost.

`src/server.ts` runs these steps for the page. It animates the four shots and records the narration at the same time, saves each file to `output/<title>/` as soon as it's ready, and streams its progress to the page as server-sent events. It serves only the files it saved, in byte ranges so the browser can seek in the videos, and stops making API calls if the page is closed. `public/index.html` is plain HTML and JavaScript that shows those events. `src/index.ts` does the same work in the terminal.
