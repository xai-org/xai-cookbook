---
title: Podcast from a Link
description: Turn an article or a PDF into a two-host podcast episode, and watch it being written and recorded live in a small web app.
type: app
level: beginner
languages: [typescript]
capabilities: [structured-output, streaming, text-to-speech]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Podcast from a Link

Give it a link to an article or a PDF, and it writes and records a conversation about it between two hosts. Each line is voiced as soon as Grok writes it, so the episode starts playing within seconds, before the script is finished.

## What you'll learn

- Turn a web page or a PDF into input for Grok, uploading PDFs with the Files API
- Stream a script as structured output and act on each line as soon as it's complete
- Voice each line with text-to-speech, using speech tags like `[laugh]` and `<whisper>` to shape the delivery
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/podcast-from-a-link/typescript
npm install
npm run web
```

Open http://localhost:3000, paste a link, and click **Make episode**. The page shows Grok's reasoning while it thinks, then the script as it's written, and plays the episode as the lines are recorded.

To make an episode from the terminal instead, pass a link or a path to a PDF:

```bash
npm start -- https://en.wikipedia.org/wiki/Voyager_Golden_Record
```

That saves the episode to `output/` as an MP3, with a Markdown transcript next to it.

## How it works

The shared code is in `src/podcast.ts`:

1. `readSource()` fetches the page and strips the HTML down to text. For a PDF, it uploads the file with `client.files.upload()` and passes it to Grok as an `input_file`. The upload deletes itself after an hour.
2. `writeScript()` streams the episode from `grok-4.7` with a JSON schema in `text.format`. As the JSON arrives, it reports each finished line right away, along with Grok's reasoning. It uses a low reasoning effort: at the default, Grok drafts the whole script before writing anything, which delays the first line by minutes.
3. `recordLine()` voices a line with `client.voice.speak()`. The voice API reads unknown speech tags aloud instead of rejecting them, so `cleanTags()` first removes any tag the prompt doesn't allow.

`src/server.ts` records each line as soon as it's reported, four at a time, and streams its progress to the page as server-sent events. `public/index.html` is plain HTML and JavaScript that shows those events and plays the clips in order. `src/index.ts` does the same work in the terminal and joins the clips into one MP3.

The prompt in `src/podcast.ts` makes the two voices co-hosts who both read the material and talk as equals. When one of them is set up as the interviewer, Grok writes a quiz instead: one asks nearly every question, and the other answers with facts. The prompt also says how long turns should be, from a few words to a whole paragraph, because otherwise every line comes out about the same length.

To change the hosts or their voices, edit `HOSTS` in `src/podcast.ts`. `client.voice.list()` lists the built-in voices.
