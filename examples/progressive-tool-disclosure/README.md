---
title: Progressive Tool Disclosure
seo_title: "Tool Search for AI Agents: Load Tools on Demand with the Grok API"
description: Give Grok 203 tools from a made-up company's eight work apps, show it only their names, and let it load the few each question needs with tool search.
type: recipe
level: intermediate
languages: [typescript]
capabilities: [function-calling, tool-search, streaming]
models: [grok-4.7]
env: [XAI_API_KEY]
icon: toolbox
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Progressive Tool Disclosure

This recipe shows how to give an agent built on the Grok API hundreds of tools without sending every definition with every request. In our runs, that cut the tokens each request sent by six to nine times.

Every tool you give Grok goes out with every request: its name, its description, and the JSON Schema of its arguments. Connect an agent to a few MCP servers and that's hundreds of tools, and most questions need two or three of them. With progressive tool disclosure, Grok sees only the tools' names at first and loads the full definitions of the few a question needs with tool search.

In this recipe, Grok is the assistant of Maya Chen, an engineering manager at Larkspur, a made-up company that sells booking software to fitness and wellness studios. Her workspace is connected to GitHub, Slack, Linear, Notion, Google Calendar, Gmail, Sentry, and Stripe, with 203 tools between them, modeled on the tools each service's MCP server offers. The data in them is made up too: yesterday's release broke checkout for anyone with a percent-off coupon, and the morning's fallout is spread across all eight services. Every question runs twice at once, with every definition up front and with progressive tool disclosure, and a web page shows the two side by side.

## What you'll learn

- Mark tools `defer_loading: true` and add `toolSearch()`, so Grok sees only their names and loads the definitions it needs
- Point tool search at exact tool names, since it matches words and a loose query loads the wrong tools
- Name tools after their service, like `slack_search_messages`, so Grok can pick them from the names alone
- Run the calls Grok makes in a loop, including tools that would change something, which here only say what they would have done
- Measure what progressive tool disclosure saves by asking the same question with every tool up front

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`. That's all: the workspace and its data are part of the example.

```bash
cd examples/progressive-tool-disclosure/typescript
npm install
npm run web
```

Open http://localhost:3000. The page explains the idea first, with one square for each tool and a row for each service. Click a sample question or type your own and click **Ask**. The question is then answered both ways at once, side by side: on the left with every tool sent, on the right with only the tools Grok needs. On both sides, the squares of the tools Grok loads and calls light up, a counter adds up the input tokens after each request, and a list shows each tool search and each call. Click a call to see what the tool returned. When both runs finish, the top of the page says how many times fewer input tokens the deferred run used, and whether both runs made the same calls. Click **Stop** or close the page to cancel both runs.

To ask from the terminal instead, pass a question. Without one, it asks the first sample.

```bash
npm start -- "Bluebird Bakery says we charged them twice. Did we, and has anyone replied to them?"
```

It prints each search and call, the answer, and the token counts and costs of both runs, and saves them to `output/<question>.json`.

The tool descriptions are written the way real MCP servers write theirs: what each tool does and when to use it, what it returns field by field, how its filters match, and notes about its service. They average about 280 tokens a tool, so a request with every definition up front is about 57,000 input tokens. The first request with deferred loading is about 8,000, because the names still go out.

When we ran the samples, a question took 10 to 45 seconds and two to four requests, and used 6 to 9 times fewer input tokens with deferred loading: 16,000 to 29,000 against 116,000 to 232,000. At list prices, that came to 3 to 5 cents a question with deferred loading and 15 to 29 cents with every definition up front.

## How it works

1. `src/tools.ts` defines the tools of the eight services, each named after its service, like `linear_get_issue` or `stripe_list_payment_intents`, with a description, JSON Schema parameters, and a function that runs it. The functions come from `src/workspace.ts`: `find()` lists the records that match Grok's filters and query, `get()` returns one record or one of its fields, and `change()` is for tools that would send, create, or update something. The workspace is made up, so those only say what they would have done. The records are in `src/data.ts`: the repositories, messages, issues, pages, events, emails, errors, and payments of Larkspur's morning. `describe()` writes each tool's full description from its summary, what its function returns, field by field from the glossary in `src/fields.ts`, and its service's notes.
2. `ask()` in `src/agent.ts` runs the tool loop. With deferred loading, every tool gets `defer_loading: true` and the request adds `toolSearch()`. The API leaves the deferred definitions out of the prompt but still lists every tool's name. When Grok searches, the API runs the search and returns the definitions it found as a `tool_search_output` item. The stream's `server_tool_call` event reports the search, and `response.output_item.done` reports the definitions it loaded. The calls arrive through `client_tool_call`, and `response.toInput()` carries the loaded definitions into the next request along with the calls' results.
3. Tool search matches words, not meaning, so a descriptive query can load the wrong tool. Grok can also call a deferred tool it never loaded, guessing the arguments from its name. So the instructions tell Grok to pick every tool it needs from the names, load each one with a search for its exact name and a limit of 1, and never call one it hasn't loaded. Names that start with their service make that work: `sentry_search_issues` and `linear_search_issues` are easy to tell apart without their descriptions.
4. The page and the terminal ask each question twice at the same time, once with deferred loading and once with every definition in the prompt of every request. Each run adds up its input tokens and the cost the API reports in `usage.cost_usd`. A rate-limited request is retried up to five times, because a request with every definition up front is large and can run into a tokens-per-minute limit.

In a real agent, the tools come from the MCP servers themselves: list each server's tools, mark them `defer_loading: true`, and send each call Grok makes to the server its tool came from.

`src/server.ts` serves the page and the list of tools, and runs both versions of a question for `/api/ask`. It streams both runs' searches, calls, results, token counts, and answers as server-sent events, each marked with the run it came from. It passes an `AbortSignal` to every request to Grok and aborts it when the page closes. `public/index.html` is plain HTML and JavaScript that shows those events. `src/index.ts` does the same in the terminal. The sample questions are in `src/questions.ts`.
