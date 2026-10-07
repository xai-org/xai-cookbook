---
title: Product Photo to Video Ad
seo_title: "AI Video Ad Generator: Product Photo to Video with Grok Imagine"
description: Turn one product photo into a vertical video ad with a voiceover, as Grok writes the brief, places the product in three scenes, picks one, and animates it.
type: app
level: intermediate
languages: [typescript]
capabilities: [image-understanding, structured-output, image-generation, video-generation, text-to-speech]
models: [grok-4.7, grok-imagine-image-2.0, grok-imagine-video-1.5]
env: [XAI_API_KEY]
icon: video
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Product Photo to Video Ad

This app builds an AI video ad generator with the Grok API and Grok Imagine that turns a product photo into a vertical video ad. It's a template for a multi-step creative pipeline, with Grok picking the best of three scenes before anything is animated.

Start from a single product photo and end with an eight-second vertical ad, with Grok acting as the creative director along the way. A small web app shows each step as it happens: the brief, the three scenes, Grok's pick, and the finished ad.

## What you'll learn

- Send an image to Grok and get a creative brief back as structured output
- Edit a photo to place the product in new scenes while keeping it true to the original
- Compare several images in one request and have Grok pick the best
- Turn the winning image into a video and add a voiceover
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`. If [ffmpeg](https://ffmpeg.org) is installed, the app also mixes the voiceover into the video.

```bash
cd examples/product-video-ad/typescript
npm install
npm run web
```

Open http://localhost:3000, choose a product photo or click **Sample**, and click **Make the ad**. The page works like an ad studio. The brief fills in under the photo as soon as Grok writes it, the three scenes appear on the right as they're ready, and Grok's pick is marked with its reason. The ad plays in a phone frame in the middle: it shows how long the video has been rendering, then plays the ad like a story when it's done.

To make an ad from the terminal instead, pass a photo and a description:

```bash
npm start -- ./your-product.jpg "What the product is and who it's for"
```

Without arguments it uses `sample-product.jpg`, a travel mug. Both versions save everything to `output/<product>/`, and the terminal version also writes an `index.html` there that shows the scenes, Grok's pick, and the ad. A run makes three images and one video, takes a couple of minutes, and cost about $1.35 when we ran it. At the end, the page and the terminal show what the images and video cost, which is nearly all of it.

## How it works

The shared code is in `src/ad.ts`. `makeAd()` runs these steps, saves each file to `output/<product>/`, and reports each step as it starts and each result as soon as it's ready:

1. `writeBrief()` sends the photo and your description to `grok-4.7` and gets back the product's name, three scenes, a camera move, a tagline, and a voiceover.
2. `placeProduct()` edits the photo for each scene with `client.images.edit()` in a 9:16 frame, asking it to keep the product exactly as it is. The three edits run at the same time.
3. `pickBest()` sends the original photo and the three scenes in one request and asks which scene sells the product best. The answer comes back as the scene's number and a reason.
4. `animate()` starts an eight-second video from the winning image with `client.videos.generate()` and waits for it with `client.videos.wait()`, while `narrate()` records the voiceover.
5. `addVoiceover()` uses ffmpeg to lay the voiceover over the video, with the video's own sound turned down.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first uploads the photo to `/api/photos` and then opens `/api/ad` with the id it gets back. The server runs `makeAd()`, streams its progress to the page as server-sent events, and serves the images, video, and audio the run saved. `makeAd()` passes an `AbortSignal` to every API call, and the server aborts it when the page is closed. A video that has already started keeps rendering, because the API can't cancel one.

`public/index.html` is plain HTML and JavaScript that shows those events and plays the ad. Without ffmpeg there's no final cut, so it plays the voiceover alongside the video. `src/index.ts` does the same work in the terminal and prints each step.
