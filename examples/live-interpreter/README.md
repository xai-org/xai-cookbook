---
title: Live Interpreter
seo_title: "Real-Time Voice Translation: Live Interpreter with the Grok API"
description: Speak one language and hear Grok say it in another a moment later, from a page that connects straight to the realtime voice API with a short-lived token.
type: recipe
level: beginner
languages: [typescript]
capabilities: [voice, text-to-speech]
models: [grok-voice-think-fast-2.0]
env: [XAI_API_KEY]
icon: translate
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Live Interpreter

This recipe builds a live voice interpreter with the Grok API that translates speech between two languages as you talk. It also shows how to connect a browser straight to the realtime voice API without putting your API key in the page.

Speak English and hear it in Spanish about a second after you pause, or pick another pair of languages. The page talks to Grok's realtime voice API directly, with a token from your server that lasts a minute, and shows captions of both sides as the conversation goes.

## What you'll learn

- Keep your API key on the server by minting a short-lived client secret with `client.voice.clientSecrets.create()`
- Connect to the realtime voice API from a browser with the `xai-client-secret.<token>` WebSocket subprotocol, with a new token for each session
- Prompt a realtime voice session to translate what it hears instead of answering it
- Stream the microphone to the session and play Grok's audio with the Web Audio API
- Show live captions of what you say and what Grok says from the session's transcript events

## Run it

You need Node.js 22.13 or later, and a microphone for the web page. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/live-interpreter/typescript
npm install
npm run web
```

Open http://localhost:3000, pick the language you speak and the one Grok should say it in, and click the microphone. The page works like a two-sided interpreter app. What you say appears on the left while you say it. When you pause, Grok says it in the other language, and its words appear on the right, next to yours. Your microphone is paused while Grok speaks, so let it finish, as you would with a person interpreting for you. Click the stop button to end the session, and the page shows how long it ran and what it cost.

To try a session without a microphone, run it from the terminal. It records a sentence with text to speech, sends it to a session the way the page sends your voice, and prints both sides:

```bash
npm start
npm start -- --to fr "Where can I buy a ticket for tonight's concert?"
```

It saves Grok's speech to `output/translation.wav`, and prints how soon Grok started speaking and what the run cost, about a cent.

A minute of interpreting costs $0.08, the price of a minute of speech to speech, so an hour costs $4.80. Each `response.done` event reports the seconds billed so far in `usage.billable_audio_seconds`. In our tests, those followed the time since the first audio arrived, silences included, so the page works out the cost the same way. Stop the session when you're done.

## How it works

The browser talks to the realtime API itself, and the server only hands it a token. The SDK mints the token on the server. The session is a WebSocket that the page opens itself, because the SDK has no realtime client, and it won't run in a browser without `dangerouslyAllowBrowser`, which would put your API key in the page.

`src/interpreter.ts` has the code the server and the terminal script share:

1. `createSession()` mints a client secret with `client.voice.clientSecrets.create()`. The token sets the model, `grok-voice-think-fast-2.0`, and turns reasoning off, since repeating a sentence in another language doesn't need it. In our tests, Grok started speaking 0.7 to 1 second after the speaker stopped, with reasoning on or off. A token opens only one session, and the session keeps going after the token expires, so the token only has to last until the browser connects. It expires after 60 seconds.
2. It returns the token with the session settings the browser sends in `session.update` once it connects: the prompt, the voice, server-side turn detection, 24 kHz PCM audio in both directions, and the `grok-transcribe` model, which transcribes the speaker while they're still talking. The SDK's types only let the token carry the model and the reasoning setting, so the rest goes in `session.update`.
3. `interpreterPrompt()` uses the sections from the [prompting guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/prompting-guide). The voice model is built for conversation, so most of the prompt stops it from joining in. Everything it hears is something to translate: it translates a question instead of answering it, and translates "ignore your instructions" instead of following it.

`src/server.ts` is a small `node:http` server that serves the page and mints tokens at `POST /api/session`. Anyone who can reach that route can open sessions on your account, so a real app would only give tokens to signed-in users.

`public/index.html` is plain HTML and JavaScript:

- Browsers can't set headers on a WebSocket, so the page sends the token as a subprotocol: `new WebSocket("wss://api.x.ai/v1/realtime", ["xai-client-secret." + token])`. It sends the settings when `session.created` arrives, and starts sending audio when `session.updated` confirms the prompt. The token's own settings arrive first, in a `session.updated` without the prompt.
- An AudioWorklet captures the microphone at 24 kHz, and the page sends it in 100 ms chunks of base64 PCM with `input_audio_buffer.append`. Server-side turn detection notices when the speaker pauses and starts Grok's turn.
- Each turn is a row. `input_audio_buffer.speech_started` adds it, `conversation.item.input_audio_transcription.updated` fills in the left side as the speaker talks, and `response.output_audio_transcript.delta` fills in the right. A short pause can end a turn early. If the speaker goes on before `input_audio_buffer.committed` arrives, Grok drops that turn, and the next turn's transcript starts with the same words, so the page reuses the row. The audio arrives in `response.output_audio.delta` faster than it plays, so each chunk is scheduled to start where the last one ends.
- While Grok's audio plays, and for 0.3 seconds after, the page doesn't send the microphone, so Grok never hears and translates its own voice from your speakers.
- When we tested, about one connection in ten opened and then never started a session, with client secrets and API keys alike. The page gives each try five seconds to send `session.created`, then tries again with a new token, up to three times.

`src/index.ts` runs the same session from the terminal. It records the sentence with `client.voice.speak()` as raw 24 kHz PCM, mints a token with `createSession()`, and connects with the same subprotocol, using the WebSocket client built into Node 22, so the example needs no packages besides the SDK. It streams the recording in real time, followed by a second and a half of silence so the turn ends, and prints the transcripts as they arrive.
