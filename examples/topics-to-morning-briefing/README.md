---
title: Topics to Morning Briefing
seo_title: "AI News Briefing: Daily Audio from 𝕏 and the Web with the Grok API"
description: Turn a few topics into a two-minute spoken briefing from 𝕏 and the web, with Grok skipping the stories it already told you about and a cost cap on every run.
type: app
level: intermediate
languages: [typescript]
capabilities: [x-data, web-search, structured-output, streaming, text-to-speech]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Topics to Morning Briefing

This app builds a personal AI news briefing with the Grok API, a short spoken digest of what's new on the topics you follow. It's a pattern for any scheduled research job: search a fixed window, remember what's been covered, and cap what each run can spend.

Pick a few topics, and each morning it searches 𝕏 and the web for what happened since your last briefing, skips the stories it already told you about, and reads you the rest in about two minutes, with the posts and articles behind each story. It runs as a small web app that plays the briefing like a podcast episode while Grok researches the next topic, or in your terminal on a schedule.

## What you'll learn

- Search a fixed time window with X Search's `from_date` and `to_date`
- Remember what each briefing covered, and let Grok decide whether a story is new, an update, or one you've heard
- Use citations to keep only the posts and articles the searches returned
- Show each search as it runs with the SDK's `server_tool_call` event
- Cap what a run costs with the cost the API reports for every request
- Voice each part of the briefing with `client.voice.speak()` while the next one is researched, with a few speech tags
- Run it on a schedule with cron or `--every`

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/topics-to-morning-briefing/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Brief me**. The page starts with the topics in `topics.txt`: SpaceX, Formula 1, and AI chips. Remove one with its ×, or type a new one and press Enter. The page works like a podcast player. Each topic shows its searches as they run, then its stories with the 𝕏 posts and articles beside them. The briefing starts playing as soon as the first topic is ready, highlights the topic being read, and lights up the words as they're spoken. Click **Brief me** again, and it tells you there's nothing new on the stories it already covered. The start screen shows what it remembers, and **Forget them** clears it. Click **Stop** or close the page to cancel a run.

To make a briefing from the terminal instead:

```bash
npm start
```

That briefs the topics in `topics.txt`, one per line, or the ones you pass, like `npm start -- "SpaceX" "Formula 1"`. Both versions save the briefing to `output/<time>/briefing.mp3` and what it covered to `output/memory.json`, and the terminal version writes show notes with every link to `briefing.md` next to the MP3.

When I ran it, a briefing on the three sample topics took one to two minutes, and up to five when the API was busy. It cost about 45 cents: about 20 cents for X Search and web search, about 20 cents for tokens, and 3 cents for speech. A run with nothing new costs about half that. X Search is billed at $5 per 1,000 posts it fetches, web search at $5 per 1,000 calls, and speech at $15 per million characters.

## Run it on a schedule

Each run stops starting topics before it would go over a cost cap, $1 unless you pass `--max-cost`. On the page, it's the **Cost cap** menu. To brief yourself every morning at 7, add a line like this with `crontab -e`. Cron runs commands with a short `PATH`, so replace `/path/to/node/bin` with the folder that `dirname "$(which node)"` prints:

```
0 7 * * * cd /path/to/xai-cookbook/examples/topics-to-morning-briefing/typescript && PATH="/path/to/node/bin:$PATH" npm start -- --max-cost 0.75 >> "$HOME/morning-briefing.log" 2>&1
```

Or keep it running in a terminal with `--every`, which briefs again that long after each briefing started, until you press Ctrl+C:

```bash
npm start -- --every 1d
```

## How it works

The shared code is in `src/briefing.ts`, and the memory is in `src/memory.ts`. `makeBriefing()` researches the topics one at a time, reports each step through callbacks, and voices each topic while the next one is researched:

1. `loadMemory()` reads `output/memory.json`, which lists each briefing's time, cost, the topics it researched, and the stories it reported. `searchWindow()` gives each topic a window from the day it was last covered, or from yesterday the first time, through today. X Search takes whole days in UTC, and `to_date` is exclusive, so the window ends tomorrow to include today. The X Search docs say `to_date` is included, but a search for the latest posts with `to_date` set to today returned none from today.
2. `researchTopic()` streams one `grok-4.7` request with `xSearch({ from_date, to_date })` and `webSearch()`, and a JSON schema in `text.format`. The prompt lists the stories already reported on that topic in the last week and when the last briefing went out. Grok returns the stories it found, each marked new, an update, or old, along with the posts and articles behind them and what the host says about the topic. Since X Search only takes dates, Grok uses the time of the last briefing to tell what broke after it, and often narrows its own queries with 𝕏's `since:` operator down to the minute. The `server_tool_call` event reports each search as it runs. The `citation` event collects every URL the searches returned, and any post or article that wasn't among them is dropped. The request uses a low reasoning effort, since the searches do the work. `max_turns` bounds how many rounds of searches a topic can run, and `idleTimeout` keeps a stalled stream from holding up a scheduled run.
3. Every response reports what it cost in `usage.cost_in_usd_ticks`, including the searches, and the SDK converts it to dollars in `usage.cost_usd`. The cost arrives only when a request is done, so a topic can't be stopped partway. Instead, a topic starts only if it would fit under the cap at the cost of the priciest topic so far. Before any topic has run, it uses the average cost of a topic in the last briefing. The outro names any topic it skipped, and the next briefing searches that topic from further back.
4. `recordClip()` voices each topic's script with `client.voice.speak()` as soon as it's written. Grok can use a couple of speech tags, like `[pause]` between stories or `<emphasis>` on a word. The voice API reads aloud any tag it doesn't know, so the SDK's `stripInvalidSpeechTags()` removes those first. Now and then Grok also leaves citation markup like `<citation id="web:23"/>` in the script, which the voice reads as "citation ID web 23", so `stripCitations()` removes it. The voice API doesn't report a cost, so speech is counted at its price per character. The code writes the intro and the outro itself.
5. Once every topic is done, the clips are joined into one MP3, and `remember()` adds the new stories and updates to the memory file. A run that's stopped doesn't change the memory.

`src/server.ts` runs `makeBriefing()` for the topics from the page and sends each step to it as a server-sent event. It runs one briefing at a time, since each one rewrites the memory file, and passes an `AbortSignal` to every request, so closing the page or clicking **Stop** cancels whatever is running. It serves only the audio files the run wrote, in byte ranges so the browser can seek. `public/index.html` is plain HTML and JavaScript that shows those events and plays the clips in order. `src/index.ts` prints the same steps in the terminal and writes the show notes.

To change the voice, edit `VOICE` in `src/briefing.ts`. `client.voice.list()` lists the built-in voices.
