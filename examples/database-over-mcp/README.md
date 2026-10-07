---
title: Database over MCP
seo_title: "Chat with Your Database: SQLite MCP Server with the Grok API"
description: Serve a SQLite database as a small MCP server that only reads, and watch Grok list its tables, read their schemas, and run SQL through it to answer a question.
type: recipe
level: intermediate
languages: [typescript]
capabilities: [mcp, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
icon: database
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Database over MCP

This recipe connects the Grok API to a SQLite database through a small MCP server you run yourself, so Grok can answer questions from your own data. It's a template for giving an agent read-only access to any database, with the limits enforced by the server rather than trusted to the model.

Ask a question about a small coffee store's sales, and Grok answers it from a SQLite database on your machine. A short MCP server, written with nothing but Node, serves the database, and a tunnel gives it a public URL so SpaceXAI can reach it. Grok lists the tables, reads their schemas, and runs SQL, and the page shows each query and its rows before the answer. The server only reads: it opens the file read-only and turns away anything but a single SELECT, whatever the model sends.

## What you'll learn

- Write a minimal MCP server over Streamable HTTP with `node:http` and four JSON-RPC methods
- Connect it to Grok with the SDK's `mcp()` tool, limit Grok to its tools with `allowed_tools`, and pass a bearer token with `authorization`
- Enforce read-only on the server instead of trusting the model: a read-only connection, one SELECT per query, a row cap, and a time limit that kills slow queries
- Give a server on your machine a public URL with a Cloudflare quick tunnel, since SpaceXAI connects to MCP servers from its side
- Show each MCP call as it starts and finishes with the SDK's stream events, next to the requests the server receives

## Run it

You need Node.js 22.13 or later and [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/), which opens the tunnel without an account (`brew install cloudflared` on a Mac). Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/database-over-mcp/typescript
npm install
npm run web
```

It builds the sample database, starts the MCP server on port 3001, and opens a tunnel to it, which takes about five seconds. Then open http://localhost:3000 and click a question, or write your own. The page works like a SQL notebook. Grok's thinking and each call to your MCP server appear as cells as they happen, with the SQL it ran and the rows that came back, then the answer, with a chart of the last result and what it cost. The panel on the right is your server: the route from SpaceXAI through the tunnel, the tools Grok may call, and each request as it arrives. The guard tests ask Grok to send SQL the server turns away, so you can watch each guard work: an UPDATE, two statements in one query, a query that would run for minutes, which the server stops after 5 seconds, and one that would return every row, which comes back cut off at 100. The samples show up again under each answer, so you can try one after another. Click **Stop** or close the page to cancel.

To ask from the terminal instead, pass a question. It defaults to "Which products sold best last month?"

```bash
npm start -- "Who are our best customers?"
```

That prints each call with its rows, and saves the answer with every query and its result to `output/<question>.md`.

A question takes about 10 seconds and about five calls to the MCP server, and cost about a cent when we ran it, between $0.008 and $0.012. SpaceXAI doesn't charge for remote MCP calls, only for tokens, including the tool results Grok reads.

The tunnel stays open while the app runs and closes when it stops. While it's open, the server only answers requests that carry the token of an answer in progress. To use another tunnel, like ngrok, point it at port 3001 and set `MCP_PUBLIC_URL` to its URL. `PORT` and `MCP_PORT` change the ports.

## How it works

`src/make-store.ts` builds `store.db`: a small coffee store with 160 customers, 18 products, and about 1,350 orders over the last six months. Its random numbers come from a fixed seed, so every start builds the same store, moved to end today, and "last month" always has sales. A new coffee came out 40 days ago, so last month's best seller isn't the usual favorite.

`src/mcp-server.ts` is the MCP server. It's a hand-written JSON-RPC handler on `node:http` rather than the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): a server that only offers tools needs four methods, `initialize`, `ping`, `tools/list`, and `tools/call`, and handling them in one short file shows what goes over the wire without adding a dependency. In Streamable HTTP, every message is a POST to one URL, here `/mcp`. Requests get a JSON reply and notifications get a 202 with no body. This server never sends messages of its own, so a GET gets a 405 instead of a stream. Plain JSON replies also work through Cloudflare's quick tunnels, which don't support server-sent events. The server has three tools:

- `list_tables` lists the tables and how many rows each has.
- `describe_table` returns a table's `CREATE TABLE` statement and its first three rows. Comments in the schema say what the order statuses are and that prices are in cents, and Grok reads them.
- `run_query` runs one SELECT that Grok wrote.

The model writes the SQL, so the server enforces read-only itself:

1. Each query runs in `src/query.ts`, which opens the database with `readOnly: true`, so SQLite refuses to write whatever the SQL says.
2. Only SQL that starts with SELECT or WITH runs. A read-only connection still allows ATTACH, which can open and read any other SQLite file on the machine, and temporary tables.
3. `prepare()` compiles the first statement and quietly drops the rest, so SQL with anything after its first statement is turned away.
4. It returns at most 100 rows, and fewer if they're long, since they go into Grok's context.
5. Each query runs in a child process, which the server kills after 5 seconds. SQLite can't stop a running query from another thread, and a worker thread running one can't be terminated until the query ends.

A refused or failed query comes back as a tool result with `isError: true`, so Grok reads why and can fix its SQL. The tools also carry the `readOnlyHint` annotation, but that's a hint for clients, and nothing relies on it.

`src/ask.ts` puts it together. `openStore()` builds the database, starts the MCP server, and opens the tunnel with `src/tunnel.ts`, which starts `cloudflared` and waits until the tunnel's hostname shows up in public DNS, since SpaceXAI can't reach it before then. `ask()` streams a `grok-4.7` request with one tool:

```ts
mcp({
  server_url: store.url,
  server_label: "store",
  server_description: "The coffee store's SQLite database, with customers, products, orders, and order items. Read-only.",
  allowed_tools: ALLOWED_TOOLS,
  authorization: token,
})
```

- SpaceXAI connects to the server and calls the tools itself, so there's no tool loop to write. It opens one MCP session to list the tools before Grok starts and another for Grok's calls. The stream reports each call with a `response.output_item.added` event when it starts and through the `server_tool_call` listener when it's done, with its arguments and the server's reply.
- `authorization` reaches the server as `Authorization: Bearer <token>`. Every answer gets its own random token, which the server forgets as soon as Grok is done, so a token is useless once its answer is in.
- `allowed_tools` lists the tools Grok may call. Grok sees each one with the server's label in front, like `store___run_query`, and a tool the server adds later stays out of reach until it's listed here.
- It uses a low reasoning effort. Grok reasons again after every call, and at the default effort it gave the same answers to the sample questions but took up to twice as long, with extra queries to check its work.
- The cost is what the API reports in `usage.cost_usd`.

`src/server.ts` serves the page on one port and the MCP server on another, so the tunnel exposes only the MCP server and not the page, which would let anyone spend your API credits. It runs `ask()` for each question and streams each step to the page as server-sent events, along with each request the MCP server receives with that answer's token. It passes an `AbortSignal` to the request, so closing the page or clicking **Stop** cancels it. `public/index.html` is plain HTML and JavaScript that shows those events as a notebook. `src/index.ts` prints the same steps in the terminal.
