---
title: Photo to Time-Lapse
seo_title: "AI Time-Lapse Generator: Turn a Photo into a Video with Grok Imagine"
description: Turn one photo into a time-lapse, like a street through the four seasons, by editing it for each stage and pinning every edit in one Grok Imagine video.
type: app
level: intermediate
languages: [typescript]
capabilities: [image-understanding, structured-output, streaming, image-generation, video-generation]
models: [grok-4.7, grok-imagine-image-2.0, grok-imagine-video-1.5]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Photo to Time-Lapse

This app builds an AI time-lapse generator with Grok Imagine that turns one photo into a video of it changing over time. It shows how to keep a scene consistent by editing one photo for each stage, and how to pin images at set moments in a video.

Start from a single photo and end with a ten-second time-lapse of it changing, like a street going through the four seasons or a sketch turning into a painting. Grok looks at the photo and plans the stages, each stage is an edit of the photo, and one video passes through every edit at the moment it's pinned to. A small web app shows each step as it happens and lights up each pin as the video plays past it.

## What you'll learn

- Send a photo to Grok and stream a plan back as structured output, one stage at a time
- Keep a scene identical across images by editing one photo instead of generating new ones
- Pin images at set moments in one video: the first frame, keyframes on a grid of thirds of a second, and the last frame
- Wait on a long video job while showing its progress, and save the video before its URL expires
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/photo-to-time-lapse/typescript
npm install
npm run web
```

Open http://localhost:3000. The sample photo of a street corner is already loaded, so click **Make time-lapse** to take it through the four seasons, or pick another change first: empty lot to building, day to night, or sketch to painting. You can also drop in your own photo or describe your own change. The page works like a keyframe editor. Grok's reasoning and plan fill the panel on the left, each stage lands on the timeline at its mark, and its still fills in as soon as the edit is done. While the video renders, the monitor shows how far along it is. Then the video plays, and each pin lights up as the playhead reaches it. Click a pin to jump to it, and click **Stop** to cancel a run.

To make a time-lapse from the terminal instead, pass a photo and either a preset (`seasons`, `day-to-night`, `sketch-to-painting`, or `construction`) or a change in your own words:

```bash
npm start -- ./your-photo.jpg day-to-night
npm start -- ./your-photo.jpg "A field of tulips, from closed buds to full bloom"
```

Without arguments it uses `sample-street.jpg`, which we made with `grok-imagine-image-2.0`, and the four seasons. Both versions save the plan, the stills, and the video to `output/<title>/`, and the terminal version also writes an `index.html` there that plays the video above its pinned stills. A run usually makes four images and one ten-second video, and takes two to four minutes. It cost $1.72 when we ran it: $0.07 for each edit and $1.44 for the video. At the end, the page and the terminal show what the images and video cost, which is nearly all of it.

## How it works

The shared code is in `src/timelapse.ts`. `makeTimeLapse()` runs these steps, saves each file to `output/<title>/`, and reports each step as it starts and each result as soon as it's ready:

1. `planStages()` sends the photo and the change to `grok-4.7` and streams back a title, the stages, and a sentence on how the scene moves between them, as structured output. Each stage has a label, an instruction for the image editor, and the second the video should reach it. It reports Grok's reasoning as it arrives and each stage as soon as it's written. The plan is short, so even at the default reasoning effort it usually takes less than half a minute.
2. `placeStages()` puts each stage on the clip's grid. The first stage becomes the first frame and the last one the last frame. The ones between become keyframes, and the API takes at most four of them, strictly inside the clip, on a grid of thirds of a second, with no two in the same slot. So each one snaps to the grid and moves to the next free slot if it has to.
3. `editPhoto()` makes each stage's still with `client.images.edit()`, always from the original photo. Editing keeps the camera, the framing, and the buildings the same in every still, so the video only has to animate the change. The edits run at the same time.
4. `renderVideo()` starts one ten-second `grok-imagine-video-1.5` job with `client.videos.generate()`: the first still as `image`, the ones between as `keyframes` at their stage's second, and the last as `last_frame`. SDK 0.2.2 has `keyframes` but not `last_frame` yet, so `last_frame` is added with a cast, and its image goes in as a data URL because the SDK only converts Blobs in the fields it knows. Pinning the last stage as a keyframe a third of a second before the end works too, but the video keeps changing after that pin and ends a little off the still.
5. `waitForVideo()` polls `client.videos.get()` every five seconds and reports the progress the API sends with each answer, which `client.videos.wait()` doesn't pass on. The video's URL is temporary, so `renderVideo()` downloads the video as soon as it's done.

In our runs, the first and last frames matched their stills, and each keyframe's still showed up within a third of a second of its mark, usually a little early.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first uploads the photo to `/api/photos` and then opens `/api/time-lapse` with the id it gets back. The server runs `makeTimeLapse()`, streams its progress to the page as server-sent events, and serves the stills and the video the run saved, in byte ranges so the browser can seek. `makeTimeLapse()` passes an `AbortSignal` to every API call, and the server aborts it when the page is closed or you click **Stop**. A video that has already started keeps rendering and is billed, because the API can't cancel one.

`public/index.html` is plain HTML and JavaScript that shows those events on a timeline and plays the video. `src/index.ts` does the same work in the terminal and prints each step.
