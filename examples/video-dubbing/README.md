---
title: Video Dubbing
seo_title: "AI Video Dubbing: Dub a Video into Another Language with the Grok API"
description: Dub a video into another language, with each line timed to the original speech, shortened by Grok when it runs long, and mixed over the original background.
type: app
level: advanced
languages: [typescript]
capabilities: [speech-to-text, structured-output, streaming, reasoning, text-to-speech]
models: [grok-4.7, grok-voice-transcribe-2.0]
env: [XAI_API_KEY]
icon: sound
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Video Dubbing

This app builds an AI video dubbing tool with the Grok API that translates the speech in a video into another language. It brings together speech to text, translation as structured output, and text to speech, mixed back into the video with ffmpeg.

Give it a video, and it comes back dubbed into another language. Each line of the dub starts where the original line started and fits in the time the original took, in a different voice for each speaker, over the original background. A small web app plays the original and the dub side by side, with both languages in the transcript and a timing bar for every line.

## What you'll learn

- Transcribe speech with a start and end time for every word, and with diarization, so each speaker gets their own voice
- Give each line a time slot, and translate the lines as structured output with a length budget for each
- Measure each recording with the character timings from text to speech, ask Grok to shorten a line that runs long, and record it again
- Record lines in parallel as soon as they're translated, and mix them over the original sound with ffmpeg
- Stream progress from a Node server to a web page with server-sent events, and cancel the work when the page closes

## Run it

You need Node.js 22.13 or later and [ffmpeg](https://ffmpeg.org). Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/video-dubbing/typescript
npm install
npm run web
```

Open http://localhost:3000, pick a language, and click **Dub the sample clip**, or choose or drop an MP4 or MOV of your own. The page works like a dubbing studio. The transcript fills in with each line, its speaker, and its slot, then Grok's translation streams in next to it while Grok's reasoning shows over the dub's monitor. Each line's timing bar shows the dub against the original. A line that runs long turns orange past the end of its slot, then shrinks back when it's shortened and recorded again, with the earlier version struck through. When the dub is mixed, the two videos play together. Switch between **Original** and **Dub** to hear either one, and watch the words light up in both languages as they're said. Click a line to jump to it, or click **Stop** to cancel.

To dub from the terminal instead, pass a video and a language code:

```bash
npm start -- ./your-video.mp4 fr
```

Without arguments, it dubs `sample-clip.mp4` into Mexican Spanish. The sample is 35 seconds of two friends stargazing on a rooftop, made from a Grok Imagine still, two built-in voices, and a quiet synthesized background, joined with ffmpeg. Both versions save everything to `output/<video>-<language>/`: the audio sent for transcription, each line's final recording, `script.json` with every version of every line and its timings, and `dubbed.mp4`.

A run of the sample took 15 to 45 seconds when we ran it, longer when the API was busy, and cost 1 to 3 cents. Usually one to three of its 12 lines ran long and were shortened. Grok's share of the cost comes from `usage.cost_usd`. The voice API doesn't report what a request cost, so the app works out the rest from the seconds transcribed and the characters spoken, at the [list prices](https://docs.x.ai/developers/pricing).

The dub uses built-in voices, given to the speakers in the order they first speak. To keep each speaker's own voice instead, clone it as a [custom voice](https://docs.x.ai/developers/model-capabilities/audio/custom-voices) and put its ID in `VOICES` in `src/dub.ts`. Creating custom voices through the API takes an Enterprise plan.

## How it works

The shared code is in `src/dub.ts` and `src/fit.ts`. `dubVideo()` runs these steps, saves each file to `output/<video>-<language>/`, and reports each step as it starts and each result as soon as it's ready:

1. `extractAudio()` uses ffmpeg to take a 16 kHz mono FLAC from the video, and `transcribe()` sends it to `client.voice.transcribe()` with `diarize: true`. Each word comes back with its start and end time and a speaker number. With `diarize`, the API reads the audio's format from the upload's file name, so the audio is sent as a named `File`. A `Blob` from `openAsBlob()` is rejected as format `blob`.
2. `splitLines()` groups the words into lines, starting a new line when the speaker changes, a sentence ends, or there's a pause. A line's slot runs from its first word to just before the next line starts, and at most 0.3 seconds past its last word.
3. `translateLines()` streams the translation from `grok-4.7` as structured output. Each line goes in with its slot in seconds and a budget of characters, about 17 a second, or 6 to 7 for Chinese, Japanese, and Korean. Lines shorter than 1.2 seconds get the budget of a 1.2-second line, because squeezed any tighter, Grok drops words the line needs. Grok is also told whether each speaker is voiced by a man or a woman, so words that agree with the speaker match the voice. As the JSON arrives, the stream's `json` event hands over the lines so far, and each line is recorded as soon as it's complete. It uses low reasoning effort: at the default, Grok worked out the length of every line before writing any, which took six minutes for the sample.
4. `fitLine()` in `src/fit.ts` records each line with `client.voice.speak()` and `with_timestamps: true`, which returns the audio with a start and end time for every character. A pause is timed on the space or punctuation before it, so the speech runs from the first letter to the last. If that's more than 5% longer than the slot, `shortenLine()` sends the line back to Grok, and the line is recorded again, up to twice. The character timings show how much of the line had been said when the slot ran out, and Grok is asked to cut the rest, plus 5%, as a percentage. Asked for an exact number of characters, Grok spends seconds counting letters. A line that's still over its slot is recorded faster with `speed`, at most 1.15 times. Recordings vary in length, and even a faster one can come out longer than the take before it, so the shortest take is the one kept.
5. `mixDub()` uses ffmpeg to turn the original sound down to a quarter and lay each recording where its line starts. Each recording goes in earlier by the silence it starts with, so its first word lands where the original's first word did.

Lines are recorded six at a time. A dub sends a burst of requests, so the SDK client retries a rate limit five times instead of two, and sends a Grok request again if it fails before Grok writes anything, with `retryBeforeOutput`. The SDK doesn't resend a speech request whose connection drops, so each recording is tried up to three times.

`src/server.ts` runs `dubVideo()` for the page. `EventSource` can only make GET requests, so for your own video, the page first uploads it to `/api/videos`, then opens `/api/dub` with the id it gets back and receives each step as a server-sent event. The server serves the dubbed video in byte ranges, so the browser can seek in it, and serves only the files a run saved. It aborts every API call if the page is closed or **Stop** is clicked. `public/index.html` is plain HTML and JavaScript that shows those events. The original video keeps the time, and the dub plays in step with it, muted unless it's the one you're hearing. The words light up from the transcription's word timings in the original, and from the speech's character timings in the dub. `src/index.ts` does the same work in the terminal and prints every line with its timing.
