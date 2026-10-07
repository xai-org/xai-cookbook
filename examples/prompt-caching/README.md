---
title: Prompt Caching
seo_title: "Prompt Caching: Cut the Cost of Long Chats with the Grok API"
description: Play one 30-message chat three ways to see what the prompt cache saves, how the time at the top of the system prompt breaks it, and what compaction costs.
type: guide
level: intermediate
languages: [typescript]
capabilities: [chat, streaming, prompt-caching, compaction, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
icon: coins
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Prompt Caching

This guide shows how prompt caching cuts the cost of long chats with the Grok API, and what quietly breaks it. Putting the current time at the top of the system prompt made the same chat cost 2.2 to 2.9 times as much in our runs.

Every turn of a chat sends the whole chat again, so each turn costs more than the last. When a prompt starts the same way as the last one, Grok reads that part from the prompt cache at a quarter of the price. This example plays the same 30 messages in three chats at once and charts what every turn cost. All three tell Grok the current time. The first puts it at the top of the latest message. The second puts it at the top of the system prompt, as many apps do, and that one line keeps the rest of the prompt from coming from the cache. The third is like the first, but compacts the chat as it grows.

## What you'll learn

- What prompt caching needs: a prompt that starts the way the last one did
- What breaks it, like the current time at the top of the system prompt, and where to put the time instead
- Where cached tokens show up in `usage`, and how to price a turn from its token counts
- Send every turn of a chat to the server that has it cached with `prompt_cache_key`
- Carry Grok's encrypted reasoning from turn to turn with `toInput()`, so the cache covers Grok's earlier answers too
- Compact a chat with `responses.compact()`, what it costs, and why the turn after it misses the cache
- Time each turn from the attempt that got through, with the SDK's `onRequest` hook

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/prompt-caching/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Play the chat three ways**. All three chats talk to the crew assistant of Ares Station, a made-up research station on Mars, which answers from the station's handbook, `handbook.md`. The handbook is about 2,100 tokens and goes out in every prompt, the way a support bot sends its help docs. The page plays the 30 messages in `script.txt` in the three chats at once. The line at the top compares the first two over the turns both have finished. Under it, each chat shows its total, how it compares with the first chat, a bar for every turn split into cached input, new input, output, and compacting, and the conversation so far, with how much of each turn's prompt was read from the cache. Hover a bar to see that turn's tokens and cost by part, and why it did or didn't hit the cache. Click a bar to scroll every chat to that turn. **Stop** cancels the run, and **Results** downloads every turn as JSON when it's done.

To run it from the terminal instead:

```bash
npm start
```

It prints each turn and compaction as it finishes, then a summary, and saves every turn to `output/comparison-<time>.json`. Pass a number to play only that many turns, like `npm start -- 10`. Edit `handbook.md` and `script.txt` to try your own.

The run in the table below took 3 minutes 13 seconds and cost 56 cents at list price, 27 cents of it for the chat with the time on top.

## How it works

The code that sends each turn is in `src/chat.ts`:

1. `sendMessage()` streams one turn from `grok-4.7`. The input is the chat's latest compaction item if it has one, then the system prompt with the handbook, then the turns since, then the new message. The first and third chats start their latest message with `Current time:` and the time, and the second starts its system prompt with it. The time changes on every turn, so at the top of the system prompt it makes the whole prompt new. At the top of the latest message, it's part of what's new anyway.
2. It sets `prompt_cache_key` to `chat:` and the chat's ID, which sends every turn of a chat to the server that has the chat cached. It uses a low reasoning effort, which answers a question about the handbook in a few seconds.
3. It adds the message and `response.toInput()` to the chat. `toInput()` includes Grok's reasoning items with their encrypted content. Without them, the next turn's cache hit stops where Grok's last answer begins, and Grok loses the reasoning behind its earlier answers.
4. The SDK's `Usage` type has the counts: `usage.input_tokens`, `usage.input_tokens_details.cached_tokens` for the part read from the cache, and `usage.output_tokens`, which includes `usage.output_tokens_details.reasoning_tokens`. The API also reports each response's billed cost in `usage.cost_usd`, but only as a total, and a compaction reports no cost at all. So `price()` works out each part from the token counts with the rates from `client.models.language.get()`: $2.00 per million input tokens, $0.50 per million cached ones, and $6.00 per million output tokens.
5. `compactChat()` sends the chat's turns, with its previous compaction item, to `client.responses.compact()`, and keeps the single encrypted item it returns in place of them. `compacted.usage` has the tokens it used and `dropped_message_count`. Unlike a response's, its `output_tokens` don't include its reasoning tokens. The third chat compacts once the turns since its last compaction pass `COMPACT_AFTER`, 1,500 tokens. Those turns are all a compaction can shrink. A limit on the whole prompt, like 4,500 tokens, made our chat compact after every turn once a summary was about as big as the room left under it.
6. A compaction item has to come first, because the API drops anything before it, `instructions` included. So the system prompt stays out of the compaction and goes right after the item, which keeps the handbook word for word however often the chat is compacted. Compacted along with the turns, the system prompt survives the first compaction word for word, but the next compaction summarizes it with everything else.
7. Every request runs through the client's `onRequest` hook, which records when each attempt starts, so a rate-limit retry doesn't count as a slow first token. The client retries up to seven times instead of the default two, since three chats run at once. The SDK waits longer before each retry, up to 30 seconds, so seven retries can wait out a limit on tokens per minute. The client also sets `retryBeforeOutput`, so a failed request doesn't stop a chat halfway through.

`src/compare.ts` defines the three chats in `CHATS`, plays the script in all of them at once with `compare()`, and saves the results. `src/server.ts` is a small `node:http` server. `/api/compare` plays the chats, streams every turn and compaction to the page as server-sent events, and stops them if the page is closed. The server serves only the results files its runs wrote. `public/index.html` is plain HTML, CSS, and JavaScript that shows those events. `src/index.ts` runs the comparison in the terminal.

## What the comparison showed

All three chats send the same 30 messages. Here is one run:

| Chat | Cost | Input read from the cache | Median time to first token | Compactions |
| --- | --- | --- | --- | --- |
| Time in the message | $0.117 | 87% | 0.6 s | 0 |
| Time on top | $0.270 | 3% | 0.7 s | 0 |
| With compaction | $0.167 | 86% | 0.7 s | 3 |

- **What the time on top costs.** That chat never starts the same way twice, so it read 128 tokens from the cache per turn, a preamble every request shares, and paid full price for the rest. Its cost per turn climbed from 0.6 cents to 1.2 cents as the chat grew from 2,400 to 5,900 tokens, while the first chat's mostly stayed between 0.2 and 0.5 cents. It cost 2.3 times as much as the first chat in this run, and 2.2 to 2.9 times as much across our runs. The gap grows with the chat, since every turn resends everything before it.
- **Compaction cost more than it saved.** The three compactions cost 1.4, 1.7, and 3.3 cents and took 19, 29, and 53 seconds. They wrote summaries of 600 to 1,800 tokens, plus up to 2,600 reasoning tokens, all at the output price, while removing only 600 to 900 tokens from the prompt. The turn after each one read only 128 tokens from the cache, because the summary is new and comes first, and it cost about three times a normal turn. The chat cost 1.4 times as much as the first one in this run. With caching, each 10,000 tokens a compaction removes saves half a cent per turn, so compaction pays off for long chats whose turns are many times the size of a summary, or for staying inside the context window. Here, `COMPACT_AFTER` is low so that the chat compacts a few times.
- **What compaction can lose.** In this run, all three chats answered the last question right: bunk 9, suit 6, and the three peanut dinners. But summaries came back anywhere from 15 to 2,350 tokens in our tests, and the 15-token one forgot the user's suit number. When the system prompt was compacted along with the turns, the prompt after the second compaction was smaller than the system prompt alone, so Grok was working from a summary of the handbook. With the system prompt before the compaction item or in `instructions`, the API dropped the handbook entirely, and Grok made up menu details, like dinners that aren't on it.
- **Caching works in blocks of 128 tokens.** Every cached count was a multiple of 128, so the last partial block of a prompt is always new.
- **The cache key makes a hit likelier, not certain.** The first chat missed the cache on three turns besides its first while the API was busy. When we also played the chat without `prompt_cache_key`, the API still cached most turns, between 64% and 95% of the input with or without a key. Without a key, a request can land on a server that doesn't have the chat cached, and the key makes that less likely. To try it, remove `prompt_cache_key` from `sendMessage()`.
- **Time to first token barely changed.** At 2,400 to 6,900 tokens, reading the prompt is a small part of the wait, and turns took up to 80 seconds to start when the API was busy, cached or not.
