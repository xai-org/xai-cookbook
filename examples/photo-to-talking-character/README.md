---
title: Photo to Talking Character
seo_title: "AI Talking Photo: Make a Picture Talk with Grok Imagine"
description: Make a drawing, a mascot, or a pet photo talk in a voice you pick, and have a second character answer, with Grok Imagine reference-to-video.
type: recipe
level: beginner
languages: [typescript]
capabilities: [video-generation, text-to-speech]
models: [grok-imagine-video-1.5]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Photo to Talking Character

This recipe turns a picture of a character into a talking video with Grok Imagine. It shows how to refer to several pictures and voices in one video prompt, so two characters can talk to each other in the same video.

Give it a picture of a character, like a drawing, a mascot, or a pet, pick one of the built-in voices, and write a line. Grok Imagine makes a short video of the character saying the line in that voice. Add a second character, and it answers in its own voice in the same video. A small web app shows the request as you write it and plays the video when it's ready.

## What you'll learn

- Refer to several pictures and voices in one video prompt with `<IMAGE_0>`, `<IMAGE_1>`, `<AUDIO_0>`, and `<AUDIO_1>` tags
- Give each character a preset voice with a `voice_id` in `reference_audios`
- List the voices with `client.voice.list()`, and hear one with `client.voice.speak()` before paying for a video
- Check on a video job with `client.videos.get()` to show how far along it is
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/photo-to-talking-character/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Try the dog and the cat**, or add your own picture, pick a voice, and write a line. Then click **Make it talk**. The page works like a small animation studio. Each character on the left has a picture, a voice with a play button that says the line in it, and the line itself. The stage shows the characters with their lines in speech bubbles, and under it is the request as it will be sent, with each tag next to the picture or voice it stands for. While the video renders, the stage shows how far along it is, and then it plays the video. **Add a character who answers** adds a second character. **Stop** stops waiting, but the video still finishes and is billed, because the API can't cancel one.

To make a video from the terminal instead, pass a picture, a voice, and a line for each character. `voices` lists the voices:

```bash
npm start -- ./your-drawing.png eve "Hello! Somebody finally drew me a mouth."
npm start -- ./dog.png rex "Want to play?" ./cat.png luna "No."
npm start -- voices
```

Without arguments, it uses the sample: a drawing of a dog, `sample-dog.jpg`, that speaks in Rex's voice, and a drawing of a cat, `sample-cat.jpg`, that answers in Luna's. We drew both with `grok-imagine-image-2.0`. Both versions save the video to `output/<the first line>/scene.mp4`, with the prompt next to it in `scene.json`.

A run makes one video of 5 to 15 seconds, depending on how long the lines are, and takes about a minute, nearly all of it rendering. When we ran it, the sample made a 10-second video for $1.42, and a single line made a 5-second video for $0.71, so about 14 cents a second. Hearing a voice costs a fraction of a cent. At the end, the page and the terminal show what the video cost.

## How it works

The shared code is in `src/scene.ts`:

1. `writePrompt()` writes one prompt for the whole scene. Each tag refers to an input by its place in a list: `<IMAGE_0>` is the first picture in `reference_images`, and `<AUDIO_0>` is the first voice in `reference_audios`. So the first character is the one from `<IMAGE_0>`, speaking in the voice from `<AUDIO_0>`, and the second is the one from `<IMAGE_1>`, speaking in the voice from `<AUDIO_1>`. The prompt gives each line in quotes, in order, and asks for no other speech and no music.
2. `makeScene()` starts the video with `client.videos.generate()`. `reference_images` takes the pictures as `Blob`s, which the SDK sends as data URLs, and `reference_audios` takes a `{ voice_id }` for each character, up to three. `sceneLength()` sets the duration from the number of words, because every second is billed. Reference-to-video renders at 720p at most.
3. `waitForVideo()` checks on the video with `client.videos.get()` every three seconds and reports the `progress` percentage it returns. `client.videos.wait()` would poll for you, but it doesn't report progress. The video's URL is temporary, so `makeScene()` downloads it right away.
4. `listVoices()` lists the voices with `client.voice.list()`, and `previewVoice()` says a line in one of them with `client.voice.speak()`.

A few things to know about voices in videos:

- Only the built-in voices are open to everyone. Passing your own recording as a `url` in `reference_audios` is for trusted partners, on request.
- `client.voice.list()` returns 28 voices, but the video model doesn't take two of them, `aurora` and `liora`, so `listVoices()` leaves them out. A voice it doesn't take gets a 400 error that lists the ones it does.
- A preview plays the voice through text to speech. In the video, the character performs the line in that voice, with its own timing.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first uploads each picture to `/api/pictures` and then opens `/api/scene` with the picture ids, voices, and lines. The server runs `makeScene()`, streams its progress to the page as server-sent events, and serves the video the run saved, in byte ranges so the browser can seek. `/api/voices` lists the voices and `/api/preview` says a line in one, and the server keeps each preview, so playing it again is free. `/api/prompt` returns what `writePrompt()` writes for the current lines, so the page can show the request before it's sent. Every API call gets an `AbortSignal` that fires when the page closes the request, which is also what **Stop** does.

`public/index.html` is plain HTML and JavaScript that shows those events and plays the video. `src/index.ts` does the same work in the terminal.
