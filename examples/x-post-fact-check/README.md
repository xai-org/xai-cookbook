---
title: 𝕏 Post to Fact-Check
seo_title: "AI Fact-Checker: Check Posts on 𝕏 with the Grok API"
description: Paste a link to a post on 𝕏, and Grok checks each claim on the web and on 𝕏 at the same time and writes a note where every sentence cites a source.
type: app
level: intermediate
languages: [typescript]
capabilities: [x-data, web-search, structured-output, streaming, image-understanding, multi-agent]
models: [grok-4.7, grok-4.20-multi-agent]
env: [XAI_API_KEY]
icon: checkmark-circle
authors: [Eric Zakariasson]
date: 2026-10-05
---

# 𝕏 Post to Fact-Check

This app builds an AI fact-checker with the Grok API that checks the claims in a post on 𝕏 against the web and 𝕏. It's a pattern for research that has to cite its sources, with each claim checked in parallel.

Paste a link to a post on 𝕏. Grok reads it, images and video included, and splits it into claims. Then it checks every claim on the web and on 𝕏 in its own request, all at the same time, and writes a note like a Community Note, where every sentence links to sources the searches actually returned. It runs as a small web app or in your terminal, and shows each search and the pages it finds as they come in.

## What you'll learn

- Find a post from its link with X Search, and read its images and video with `enable_image_understanding` and `enable_video_understanding`
- Pull a post's claims out as structured output, and show them while Grok writes them
- Fan out: research each claim in its own request with `webSearch()` and `xSearch()`, all at once, then merge the results
- Trust citations instead of text: keep only the sources that came back as citations, and answer "not enough evidence" when no source backs a verdict
- Write a note that can only cite the sources you kept, with an `enum` of their numbers in the schema
- Show each search and the pages it found as it happens, with `server_tool_call` events and `include: ["web_search_call.action.sources"]`
- Switch the research to `grok-4.20-multi-agent`, where four agents work on each claim
- Stream progress from a Node server to a web page with server-sent events, and cancel the work when the page closes

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/x-post-fact-check/typescript
npm install
npm run web
```

Open http://localhost:3000, paste a link to a post and click **Fact-check**, or click one of the four sample posts: insider buying at GameStop (with an image), Starship's first orbital flight (with a video), Harry Kane drawing level with England's caps record, and this year's Nobel Prize in Physics. The page works like a fact-checking desk. The post fills in on the left as Grok reads it, with the image or video Grok looked at and what it saw there. Each claim gets a card on the right that fills with the searches Grok runs and the sites they find, then gets a verdict: supported, missing context, or not enough evidence. The note appears under the post as Grok writes it, with its sources numbered underneath, and the page shows what the run cost. Turn on **Deep research** to have four agents research each claim. Click **Stop** or close the page to cancel.

To check a post from the terminal instead, pass its link, and add `--deep` for deep research. It defaults to the GameStop post.

```bash
npm start -- https://x.com/unusual_whales/status/2106776609457844610
```

That saves the note, the claims, and their sources to `output/` as Markdown, with the whole result as JSON next to it.

When we ran it, a check took 39 seconds for the Starship post, and about three minutes for the GameStop post, which has twice as many claims and ran while the API was slow. A check of the Starship post cost about 15 cents and one of the GameStop post 30 to 40 cents. About a third of that is for searches: X Search is billed at $5 per 1,000 posts it fetches and web search at $5 per 1,000 searches. The rest is for 50,000 to 130,000 tokens. At the end, the page and the terminal show what the API reported the run cost.

## How it works

The shared code is in `src/factcheck.ts`. `factCheck()` runs three steps and reports each one through callbacks, so the web app and the terminal app show the same progress in their own way:

1. `readPost()` streams a `grok-4.7` request with `xSearch()`, and asks for the post's text, what its images and video show, and up to four claims as JSON. Grok fetches the post with X Search's `x_thread_fetch`, looks at its images by opening them on X's image server, and watches its video with `view_x_video`. The `server_tool_call` event reports each of those as it happens, with the image's or video's URL, which the page uses to show them. The `json` event hands over the post and its claims as Grok writes them, so each claim gets its card right away. Grok cites the post only if X Search returned it, so a link whose post doesn't come back as a citation fails instead of letting Grok guess what it said. The post's date comes from its ID, which holds the time it was published.
2. `checkClaim()` researches one claim in its own streamed request with `webSearch()` and `xSearch()`, and `factCheck()` runs one for every claim at the same time. Grok returns the sources it relied on, a verdict, and why, as JSON. The request sets `include: ["web_search_call.action.sources"]`, so each web search arrives in a `server_tool_call` event with the pages it found. The `citation` event lists every page and post the searches returned. A source Grok lists that isn't among them is dropped, and a verdict only stands if a kept source backs it: supported needs a source that supports the claim, and missing context needs one that contradicts it or adds context. Anything else becomes not enough evidence. A claim whose request fails becomes not enough evidence too, and the other claims carry on.
3. `writeNote()` numbers the kept sources of every claim and asks for the note as JSON: a list of sentences, each with the numbers of the sources it comes from. In the schema, those numbers are an `enum` of the kept sources, and `minItems: 1` makes every sentence cite one, so the note can't cite anything the searches didn't return. Claims without a kept source are left out of it. The `json` event hands over each sentence as Grok writes it.

All three steps use a low reasoning effort. Even so, Grok ran two to four searches for each claim, and in our runs it rated the GameStop post's claim that its CEO bought "about $57 million" as missing context: the filings, and the post's own image, add up to about $74 million.

With **Deep research** on, or `--deep` in the terminal, `checkClaim()` uses `grok-4.20-multi-agent` instead. For this model, `reasoning.effort` sets how many agents work on each claim rather than how long it thinks: low or medium is four agents, and high or xhigh is 16. The app uses low. Only the leading agent's tool calls come back, so a card shows fewer searches than the agents ran. The multi-agent model takes built-in tools like `webSearch()` and `xSearch()` but not your own functions, which is all this step needs. Deep research stores its responses for 30 days, which is the API's default. When a response isn't stored, the SDK asks for encrypted reasoning, and the multi-agent model then sends back every agent's encrypted state, which can make one stream event bigger than the 1 MiB the SDK reads.

`src/server.ts` runs `factCheck()` for the link from the page and sends each step to it as a server-sent event. It passes an `AbortSignal` to every request, so closing the page or clicking **Stop** cancels whatever is running. `public/index.html` is plain HTML and JavaScript that shows those events. It loads the post's image or video straight from X's servers. `src/index.ts` prints the same steps in the terminal and saves the result to `output/`.
