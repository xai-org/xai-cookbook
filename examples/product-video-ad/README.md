---
title: Product Photo to Video Ad
description: Turn one product photo into a vertical video ad. Grok writes the brief, places the product in three scenes, picks the best one, and animates it with a voiceover.
type: app
level: intermediate
languages: [typescript]
capabilities: [image-understanding, structured-output, image-generation, video-generation, text-to-speech]
models: [grok-4.7, grok-imagine-image-2.0, grok-imagine-video-1.5]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Product Photo to Video Ad

Start from a single product photo and end with an eight-second vertical ad, with Grok acting as the creative director along the way.

## What you'll learn

- Send an image to Grok and get a creative brief back as structured output
- Edit a photo to place the product in new scenes while keeping it true to the original
- Compare several images in one request and have Grok pick the best
- Turn the winning image into a video and add a voiceover

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`. If [ffmpeg](https://ffmpeg.org) is installed, the script also mixes the voiceover into the video.

```bash
cd examples/product-video-ad/typescript
npm install
npm start -- ./your-product.jpg "What the product is and who it's for"
```

Without arguments it uses `sample-product.jpg`, a travel mug. Everything is saved to `output/<product>/`. Open `index.html` to see the scenes, Grok's pick, and the ad, or play `final.mp4` if you have ffmpeg. A run makes three images and one video, takes a couple of minutes, and cost about $1.35 when we ran it. At the end, the script prints what the images and video cost, which is nearly all of it.

## How it works

1. `writeBrief()` sends the photo and your description to `grok-4.7` and gets back the product's name, three scenes, a camera move, a tagline, and a voiceover.
2. `placeProduct()` edits the photo for each scene with `client.images.edit()` in a 9:16 frame, asking it to keep the product exactly as it is.
3. `pickBest()` sends the original photo and the three scenes in one request and asks which scene sells the product best. The answer comes back as the scene's number and a reason.
4. `animate()` starts an eight-second video from the winning image with `client.videos.generate()` and waits for it with `client.videos.wait()`, while `narrate()` records the voiceover.
5. `addVoiceover()` uses ffmpeg to lay the voiceover over the video, with the video's own sound turned down.
