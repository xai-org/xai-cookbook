---
title: Meeting to Action Items
description: Caption a call live with a label for each speaker, keep a running list of decisions and action items, and ask questions whose answers link to the moment in the transcript.
type: app
level: advanced
languages: [typescript]
capabilities: [speech-to-text, structured-output, streaming, text-to-speech]
models: [grok-voice-transcribe-2.0, grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Meeting to Action Items

Leave it open during a call. It captions each speaker as they talk, keeps a running list of decisions and action items with owners and due dates, and answers questions about what was said, with links to the moment someone said it. It runs as a small web app that listens to your microphone or plays a sample meeting, or in your terminal on an audio file.

## What you'll learn

- Capture microphone audio in the browser as 16 kHz PCM with an AudioWorklet, and relay it through your server so the API key stays there
- Stream it to speech to text over a WebSocket, and use interim and final results, speaker labels from `diarize`, and Smart Turn, so a pause doesn't end someone's turn
- Keep notes as structured output that Grok revises after each turn, sending only the new lines, and stream each changed item in with the `json` event
- Answer questions with citations that jump to the line in the transcript
- Keep the page responsive while audio, captions, and notes all stream at once

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/meeting-to-action-items/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Play a sample meeting**, or **Start listening** to use your microphone. The page works like a meeting assistant. Captions roll in on the left with a label for each speaker, the decisions and action items fill in on the right with owners and due dates, and the speakers get their names once Grok works them out from the conversation. Ask a question, like "What did we decide about pricing?", and the answer links to the lines it comes from. Click a time to jump to its line. **Stop** ends the meeting, saves the notes and the transcript to `output/` as Markdown, and shows what the meeting cost, with a button to download the notes.

The sample is a one-minute planning call between Maya and Sam, in two of the built-in voices. The first time you play it, the app records it with text to speech and saves it to `output/sample-meeting.wav`. The page plays it through the same capture as a microphone, so you hear it while it's transcribed. To change the meeting, edit `sample-meeting.json` and delete the WAV file.

To transcribe a recording from the terminal instead, pass an audio file:

```bash
npm start -- ./your-meeting.wav
```

Without an argument it plays the sample meeting. It streams the file as fast as it plays, the way a microphone would, prints each line and each change to the notes as they happen, and saves the notes to `output/<name>-notes.md`. It reads WAV files of 16-bit mono PCM as they are, and other formats if [ffmpeg](https://ffmpeg.org) is installed.

A run of the sample takes about 75 seconds, since the audio is 68 seconds long and the last revision of the notes takes a few more, and cost about 4 cents when we ran it: under half a cent for transcription, about 3 cents for the notes, and a fraction of a cent for each question. Recording the sample costs another 1.4 cents the first time. Streaming transcription costs $0.20 an hour, so most of the cost is the tokens Grok uses to revise the notes, about a third of a cent per revision.

## How it works

1. `transcribe()` in `src/transcribe.ts` streams the audio to `wss://api.x.ai/v1/stt`. The SDK only wraps batch transcription, so this is a plain WebSocket. Node's built-in WebSocket takes an `Authorization` header, which a browser's can't, so the key stays on the server. It asks for interim results, speaker labels, and Smart Turn, and turns the results into lines, one for each turn:
   - Interim results come about once a second with the words heard so far, but they don't say who is speaking, so the page shows them in a line of their own until they're final.
   - Final results label each word with a speaker. A line ends when the speaker changes, or when Smart Turn decides the turn is over. The result at the end of a turn repeats all of its words, so words already added are skipped.
   - Smart Turn scores each pause from 0 to 1 for how likely the speaker is done. A pause in the middle of a sentence scored as high as 0.82 in our tests, so a turn ends only above 0.9, or after 3 seconds of silence. Even at 0.5 it didn't end the turn at every change of speaker, which is why diarization also ends lines.
2. `startMeeting()` in `src/meeting.ts` has Grok revise the notes each time a line ends. One revision runs at a time, and the lines that end while it runs go into the next one, so the notes are never more than one revision behind. A revision that fails, for example on a rate limit, leaves its lines for the next one.
3. `reviseNotes()` in `src/notes.ts` sends `grok-4.7` the notes so far as JSON and only the new lines, plus the three before them so it can tell who was greeted by name. It gets all of the notes back as structured output: the speakers' names, the decisions, the action items with owners and due dates, and a summary. Grok keeps each item's id, so when a due date moves from Friday to Thursday, the item changes in place, and the page shows the old date crossed out. While the notes stream in, the `json` event hands it the notes so far, and it reports each item that's new or different as soon as Grok has written it. It uses low reasoning effort: in one test, the same revision took 2.5 seconds at low effort and 6.7 at the default, with the same result. Since a revision only gets the new lines, its cost grows with the notes, not with the transcript.
4. `answer()` sends Grok the transcript with line numbers and the question, and asks it to cite lines like `[12]`. The transcript only grows at the end and comes before the question, so with a `prompt_cache_key` for the meeting, every question can reuse the cached start of the prompt.

The cost of each Grok call is what the API reports in `usage.cost_usd`. The transcription stream doesn't report a cost, so it's worked out from the audio's duration.

`src/server.ts` is a small `node:http` server. The page opens `/api/meeting` as server-sent events and gets back a meeting id, then sends the audio over a WebSocket to `/api/audio` with that id. Node has no WebSocket server built in, so that one leg uses the `ws` package, the app's only dependency besides the SDK. The server relays each chunk to the transcription stream, and sends captions, revisions, and changed items back as server-sent events. Closing the audio socket ends the meeting: the server tells the API the audio is over, waits for the last words, finishes the notes, and saves them. Questions go to `/api/answer`, which streams the answer back. Every API call gets an `AbortSignal` that's aborted when the page closes.

`public/index.html` is plain HTML, CSS, and JavaScript. An AudioWorklet captures the microphone, or the sample as it plays, on the audio thread, averages it down to 16 kHz, and posts 100 ms of 16-bit PCM at a time for the page to send. Each event changes only what it's about, like the text of one line or one item in the notes, so the page keeps up while audio goes up and captions and notes come down. `src/index.ts` does the same work in the terminal.
