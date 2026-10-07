---
title: Article to Read-Along
seo_title: "Read Aloud with Word Highlighting: Text to Speech with the Grok API"
description: Turn any article into audio that highlights each word as it's spoken, using the per-character timestamps from text to speech, and click a word to jump there.
type: recipe
level: beginner
languages: [typescript]
capabilities: [text-to-speech]
env: [XAI_API_KEY]
icon: text-highlight
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Article to Read-Along

This recipe builds a read-along player with the Grok API that turns articles into audio with word-by-word highlighting. Word timings like these are what you need for captions, karaoke-style highlighting, or jumping to any spot in the audio.

Paste a link or the text of an article, and it reads the article aloud while each word lights up as it's spoken. Click any word to jump there. The article is split into paragraphs, and the first one starts playing while the rest are still being recorded.

## What you'll learn

- Get per-character timestamps from `client.voice.speak()` and turn them into words with start and end times
- Split an article into paragraphs and play the first one while the rest record
- Highlight the word being spoken and jump to any word by comparing it with the audio's current time
- Stream each paragraph from a Node server to a web page with server-sent events, and serve the audio in byte ranges so the browser can seek in it

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/article-to-read-along/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Try the sample**, or paste a link or the text of an article and click **Read it to me**. The page works like a read-aloud app. The whole article shows right away, the first paragraph starts playing a few seconds later, and the word being spoken is highlighted as it plays. Click any word to jump there, or use the progress bar, the skip buttons, and the speed button. The panel on the right lists the paragraphs as they record and shows the start and end times of the words around the one being spoken. Click **Stop** to cancel the recordings that haven't finished.

To read an article in the terminal instead, pass a link, or a path to a text file or a saved web page:

```bash
npm start -- https://en.wikipedia.org/wiki/Voyager_Golden_Record
```

Without an argument it reads `sample-article.txt`, a short article about how a rocket booster lands itself. It saves the audio to `output/<title>/article.mp3`, and the start and end time of every word in it to `timings.json` next to it.

Speech costs $15 per million characters, so a 10,000-character article costs about 15 cents. The sample has 2,483 characters and cost 4 cents when we ran it. Its first paragraph started playing 2 to 6 seconds after the click, and all seven paragraphs, 2 minutes 35 seconds of audio, were recorded in 11 to 21 seconds. A run reads at most 20,000 characters, about 20 minutes of audio for 30 cents. To change that, edit `MAX_CHARACTERS` in `src/readalong.ts`. The voice API doesn't report what a request cost, so the app works it out from the number of characters.

## How it works

The shared code is in `src/readalong.ts`:

1. `readArticle()` fetches a link and keeps the page's title and the text of its `<p>` elements, which leaves out menus, captions, and footnote markers on most sites. For a page that doesn't keep its text in `<p>` elements, paste the text instead. `fromText()` splits pasted text into paragraphs at blank lines, or at line breaks if there are none. Square brackets become parentheses, because the voice API would take `[pause]` or `[sic]` for a speech tag.
2. `recordParagraph()` records a paragraph with `client.voice.speak()` and `with_timestamps: true`. Instead of audio bytes, the response is JSON with the audio in base64 and two arrays: `graph_chars`, the text one character at a time, and `graph_times`, a `[start, end]` pair in seconds for each character.
3. `toWords()` turns those into words. It walks the characters and starts a new word after each space, so a word starts when its first character does and ends when its last one does. `graph_chars` has one entry per Unicode character, so an emoji takes one place in it and two in a JavaScript string. That's why the code walks `graph_chars` instead of indexing into the text.
4. `recordAll()` records the first paragraph on its own, since the listener is waiting for it, and then the rest four at a time, reporting each one as soon as it's ready. A paragraph records several times faster than it plays, so playback rarely has to wait.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, and pasted text can be too long for a URL, so the page first posts what to read to `/api/articles` and then opens `/api/read` with the id it gets back. The server sends the article as soon as it's read, then each paragraph's audio URL and words as soon as they're recorded. It keeps the clips in memory and serves them in byte ranges, because Chrome won't seek in audio it can't load that way. Closing the page or clicking **Stop** aborts the recordings in progress.

`public/index.html` is plain HTML and JavaScript that plays the paragraphs one after another with a single `Audio` element. While it plays, it checks the current time on every animation frame and highlights the last word that has started. Clicking a word sets the current time to that word's start. Each word is a span with the same text and spaces as the paragraph, so nothing moves when a recording arrives.

`src/index.ts` does the same work in the terminal and joins the clips into one MP3. Each clip runs about 50 ms longer than the duration the API reports, which would add up over an article, so it works out where each paragraph starts in the joined file from the size of the clips before it: at the default 128 kbps, an MP3 is 16,000 bytes a second.

To change the voice, edit `VOICE` in `src/readalong.ts`. `client.voice.list()` lists the built-in voices.
