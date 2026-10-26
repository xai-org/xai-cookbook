---
title: Chat with Supabase Files
seo_title: "Chat with Private Files in Supabase Storage Using the Grok API"
description: Ask Grok about a file in a private Supabase Storage bucket by handing it a signed URL that expires in minutes, with each user's files kept apart by RLS.
type: app
level: intermediate
languages: [typescript]
capabilities: [files, streaming]
models: [grok-4.7]
env: [XAI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY]
icon: shield-check
authors: [Nick Littman]
date: 2026-10-16
---

# Chat with Supabase Files

This app answers questions about a file in a private Supabase Storage bucket. The user signs in, picks a file, and asks. The server signs a URL for that one file and hands it to Grok, and SpaceXSI downloads the file and searches it to answer.

Anyone who holds a signed URL can download the file until it expires, so the app keeps each one short-lived and narrow. Every question gets a new URL that lasts two minutes, signed as the user, so it can only cover a file that user can already read. Each handoff is recorded in an audit table.

## What you'll learn

- Attach a file to a Grok request by URL with `input_file` and `file_url`
- Keep each user's files apart with Storage policies
- Sign URLs as the user, so row-level security decides what can be signed
- Fall back to the Files API when SpaceXSI can't reach your project
- Record every handoff in an append-only audit table

## Run it

You need Node.js 22.13 or later, the [Supabase CLI](https://supabase.com/docs/guides/cli), and a throwaway hosted Supabase project, because the seed adds two demo users with known passwords. SpaceXSI downloads the file from its own servers, so it needs a project it can reach. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/chat-with-supabase-files/typescript
npm install
supabase login
supabase link --project-ref <ref>
supabase db push
export SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> SUPABASE_SECRET_KEY=<secret key>
npm run seed
npm run web
```

`npm run seed` uses the secret key to create the demo users, and nothing else does. Open http://localhost:3103, sign in as `alice@example.com` with `alice-demo-password`, and click a sample question. The page shows the signed URL, the search Grok ran, and the answer. **Check now** fetches the URL again and gets a 400 once it expires. **Try to read Bob's file** tries four ways to reach the other user's file, and each one is blocked.

To ask from the terminal:

```bash
npm start -- --user alice "How much is the monthly pet fee?"
```

A question took 4 to 7 seconds and cost between $0.009 and $0.017 when we ran it.

To use a local stack instead, open a shell without the three Supabase variables set and run `supabase start`, `npm run seed`, and `npm run web` in the same folder. SpaceXSI can't reach your machine, so the app uploads the file with the Files API for each answer and deletes it afterward. `FILE_MODE=upload` does the same on a hosted project. `npm run check` tests the policies and the URL's expiry without an API key.

## How it works

1. `supabase/migrations/20261016000000_files_bucket.sql` creates a private `files` bucket. Each object lives at `<user id>/<file name>`, and policies let a user read, add, and delete only in their own folder.
2. `src/storage.ts` signs with `createSignedUrl` on the user's own client. Storage checks the user's policies before it signs, so a file they can't see gets "Object not found" and no URL.
3. `src/chat.ts` streams a `grok-4.7` request with the question and `{ type: "input_file", file_url }`. SpaceXSI fetches the URL and gives Grok a search tool over the file. In upload mode it attaches a `file_id` from `files.upload` instead and deletes the file after the answer.
4. `supabase/migrations/20261016000100_file_reads.sql` adds `file_reads`, one row per handoff, with the question and when the URL expires. Users can read and add their own rows, and no one can change or delete them.

`fileMode()` in `src/config.ts` picks a signed URL for a hosted project and an upload for a local one. `src/server.ts` serves the page, keeps the session in an HttpOnly cookie, and streams each answer as server-sent events. Only `src/seed.ts` uses the secret key.

An expired URL doesn't fail the request. Grok gets an error page instead of the file and says the file doesn't answer the question. Grok reads one file per question. To search many documents together, see [Docs to Cited Answers](../docs-to-cited-answers/).
