---
title: Long-Term Memory over MCP
seo_title: "Long-Term Memory per User: Remote MCP Server with the Grok API"
description: Give Grok a long-term memory for each user through a remote MCP server on Supabase, where Postgres row-level security keeps every user's memories private.
type: app
level: intermediate
languages: [typescript]
capabilities: [mcp, chat, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY]
icon: person
authors: [Nick Littman]
date: 2026-10-16
---

# Long-Term Memory over MCP

This app gives Grok a long-term memory for each user. Grok saves facts about the signed-in user through a remote MCP server and finds them again in a later conversation. It's a starting point for any agent that should remember a user's preferences, notes, or history from one week to the next.

The MCP server is a Supabase Edge Function, and the memories are rows in Postgres. Grok sends the user's own login token with every tool call, so row-level security decides which memories it can see. No tool takes a user id, so Grok has no way to ask for someone else's.

## What you'll learn

- Write an MCP server as a Supabase Edge Function
- Pass the signed-in user's token to Grok with `mcp({ authorization })`, so every tool call runs as that user
- Keep users apart with row-level security instead of a user id in the tools
- Search memories by meaning with Supabase's built-in `gte-small` embeddings and pgvector
- Use `previous_response_id` for one conversation and Postgres for what Grok should remember after it

## Run it

You need Node.js 22.13 or later, the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), and a throwaway Supabase project, because the seed adds two demo users with known passwords. The project has to sign tokens with JWT signing keys, which new projects do. SpaceXSI calls MCP servers from its own side, so the function has to be deployed. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/grok-memory-over-mcp/typescript
npm install
supabase login
supabase link --project-ref <ref>
supabase db push --include-seed
supabase functions deploy memory --use-api
export SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key>
npm run web
```

The URL and publishable key are under **Project Settings > API Keys**. Export them instead of adding them to the shared `.env`, which every example in the repo reads.

Open http://localhost:3101, sign in as Alice, and say "Remember that I'm vegetarian and I have a cat named Miso." Each call to the memory server shows up as a cell, and the new rows appear on the right. Click **New conversation** and ask "Suggest a dinner I'd like." Grok starts with no history, searches its memory, and finds that Alice is vegetarian. Switch to Bob and ask for his cat's name, and Grok doesn't know.

To ask from the terminal, name a user. Each run is a new conversation.

```bash
npm start -- alice "What do you remember about me?"
```

A message took 4 to 12 seconds and cost between $0.004 and $0.012 when we ran it.

`npm run check` tests the MCP server and its row-level security without an API key. Run it against a local stack after `supabase start`, in a shell without `SUPABASE_URL` set. Hosted projects allow sign-ups by default, so before you use real accounts, delete Alice and Bob and add your own sign-in page.

## How it works

1. `supabase/migrations/20261016120000_memories.sql` creates `memories`, with the text, a 384-number embedding, and a `user_id` that defaults to `auth.uid()`. Policies let a user select, insert, and delete only their own rows. `match_memories` sorts a user's memories by cosine distance with pgvector, and it runs as the caller, so it can't read around the policies.
2. `supabase/functions/memory/index.ts` is the MCP server, a hand-written JSON-RPC handler with three tools: `store_memory`, `search_memories`, and `forget_memory`. `withSupabase({ auth: "user" })` from `@supabase/server` checks the token and gives the handler a client that acts as that user. It embeds text with `gte-small` inside the Edge Runtime, so there's no embedding API to pay for.
3. `src/ask.ts` sends each message to `grok-4.7` with the server as an MCP tool. SpaceXSI calls the tools itself, so there's no tool loop to write.

```ts
mcp({
  server_url: serverUrl,
  server_label: "memory",
  server_description: "Long-term memory for the signed-in user: facts they shared in earlier conversations.",
  allowed_tools: ALLOWED_TOOLS,
  authorization: accessToken, // the user's own Supabase JWT
})
```

`src/server.ts` signs users in with the publishable key and keeps each session behind an HttpOnly cookie, so the Node app never holds the secret key. `previous_response_id` carries one conversation. **New conversation** drops it, so anything Grok knows afterward came from `search_memories`.

Similarity scores from `gte-small` sit close together, about 0.77 for unrelated text and 0.80 to 0.84 for related text. So `search_memories` returns the closest five with their scores, and Grok decides which ones answer the question. Grok can repeat a tool call, so a unique index on `(user_id, content)` stores each fact once.
