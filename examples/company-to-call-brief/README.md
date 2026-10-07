---
title: Company to Call Brief
description: Prep for a sales call with a one-page brief, as Grok searches the web and 𝕏 on SpaceXAI's servers and looks up the account through CRM functions that run in your app.
type: app
level: intermediate
languages: [typescript]
capabilities: [function-calling, web-search, x-data, structured-output, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Company to Call Brief

Say "prep me for my call with Stripe," and Grok gets you ready. It searches the web and 𝕏 for what's new at the company, looks up your history with the account in a CRM through functions that run in your app, and writes a one-page brief with its sources. It runs as a small web app or in your terminal, and shows each step as it happens, marked by where it ran: on SpaceXAI's servers or in your app.

## What you'll learn

- Give Grok server-side tools, Web Search and X Search, and your own function tools in the same request
- Run the tool call loop that mixes them: SpaceXAI runs the searches on its own, and a call to one of your functions ends the request until your app sends back the result
- How `max_turns` limits the server-side turns in one request, and why it starts over after each call to your function
- Keep private data on your side by sending Grok only the fields it needs, and by carrying the conversation with `toInput()` instead of storing it on SpaceXAI's servers
- Get the brief as structured output, show it while it streams in, and keep only the sources the searches returned
- Stream progress from a Node server to a web page with server-sent events, and cancel the run when the page closes

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/company-to-call-brief/typescript
npm install
npm run web
```

Open http://localhost:3000, type a company or pick one of the accounts in the sample CRM, and click **Prep brief**. The page works like call prep in a CRM. On the left, a timeline puts each step in one of two lanes: the searches and the writing on SpaceXAI's servers, and the CRM lookups in your app, each noting what stayed in your CRM. A line marks each new request, where `max_turns` starts over. On the right, the account appears as soon as the lookups return, and then the brief streams in section by section, with the sources under each piece of news. At the end, the page shows what the run cost and lets you download the brief as Markdown. Click **Stop** or close the page to cancel.

To prepare from the terminal instead, pass a company. It defaults to Stripe.

```bash
npm start -- Shopify
```

Both versions save the brief to `output/<company>-<date>.md`. The sample CRM, `crm.json`, has four real companies as made-up accounts: Stripe, Shopify, Duolingo, and Figma. Their people, meetings, deals, and tickets are invented. Any other company works too, and the brief then says it isn't in the CRM.

A run takes about half a minute, or a minute or two when the API is busy. It cost about 10 cents when we ran it: 4 to 6 cents for the searches and about 5 cents for tokens. Web Search is billed at $5 per 1,000 searches, and X Search at $5 per 1,000 posts it fetches.

## How it works

The shared code is in `src/brief.ts`, and the CRM functions are in `src/crm.ts`. `prepareBrief()` runs a loop of requests and reports each step through callbacks, so the web app and the terminal app show the same progress in their own way:

1. Each request gives `grok-4.7` both kinds of tools: `webSearch()` and `xSearch()` from the SDK, which SpaceXAI runs, and five function tools, which your app runs: `find_account`, `get_contacts`, `get_meetings`, `get_deals`, and `get_tickets`. X Search is limited to the last 30 days, and the prompt gives today's date, since Grok doesn't know it.
2. The request streams. Grok decides what to search for, SpaceXAI runs each search, and the `server_tool_call` event reports it. When Grok calls one of your functions, the request ends there, and the `client_tool_call` event hands over the call. `lookUp()` runs it against `crm.json`.
3. The next request sends the conversation so far with `response.toInput()`, plus what each function returned. The loop stops when a response makes no function calls. A run usually takes three requests: one for `find_account`, one for the other four lookups, which Grok asks for at once, and one for the searches and the brief. Sometimes Grok also searches in a request that ends in a lookup.
4. The last response is the brief, as structured output with a JSON schema: who they are, what's new with sources, your history with the account, talking points, and risks. While it streams, the `json` event hands over the brief so far, so the page can show each section as it's written.

Mixing server-side and client-side tools brings three things to keep in mind:

- **`max_turns` starts over after each function call.** It limits the turns Grok takes with the server-side tools in one request, where a turn is thinking, running one or more searches at once, and reading the results. A call to one of your functions ends the request, and the next request counts from zero again. So `max_turns: 3` doesn't limit a whole run. The loop's own cap of six requests does. In our tests the limit wasn't strict either: with `max_turns: 2`, Grok still ran five searches one after another in a single request.
- **Private data stays on your side.** Grok sees only what your functions return, and each lookup picks the fields to send. Contacts' emails and phone numbers and the lowest discount you'd accept stay in `crm.json`, and the timeline notes what stayed behind. The SDK sends `store: false` unless you ask otherwise, so the responses aren't stored for later retrieval. The loop carries Grok's reasoning and the search results to the next request with `toInput()`, encrypted, instead of using `previous_response_id`, which would mean storing the conversation, CRM data included, on SpaceXAI's servers. The prompt also tells Grok never to put CRM data in a search, and the timeline shows every query, so you can check.
- **Citations only cover their own request.** Grok cites every source its searches return, so `keepCited()` drops any source in the brief that isn't among them, along with any news left without a source. But a response only cites the searches in that request. When Grok searches in a request that ends in a function call, that request has no citations, and the brief comes in a later one that doesn't cite those searches. So the app also counts the sources each web search reports while it streams.

`src/server.ts` runs `prepareBrief()` for the page and sends each step to it as a server-sent event. It passes an `AbortSignal` to every request, so closing the page or clicking **Stop** cancels the run, and it serves a saved brief only at the URL it made for that run. `public/index.html` is plain HTML and JavaScript that draws the timeline and the brief from those events. `src/index.ts` prints the same steps in the terminal.

The requests use a low reasoning effort. When we tried the default effort side by side, Grok followed up on what it found with a second round of searches, and the run took about 70 seconds instead of 40, for a brief with only a few more specifics.

To use your own CRM, change the functions in `LOOKUPS` in `src/crm.ts` to call it, and keep picking the fields Grok may see.
