---
title: Video Jobs That Survive a Closed Tab
seo_title: "Background Video Generation Queue with Grok Imagine and Postgres"
description: Queue Grok Imagine videos in Postgres, render them with a scheduled worker, and watch them finish live, even after you close the tab.
type: app
level: advanced
languages: [typescript]
capabilities: [video-generation]
models: [grok-imagine-video-1.5]
env: [XAI_API_KEY]
icon: clock
authors: [Nick Littman]
date: 2026-10-16
---

# Video Jobs That Survive a Closed Tab

This app queues Grok Imagine videos in Postgres, so a render keeps going after the user closes the page. It's a starting point for any app where a video takes longer to make than a user will watch a spinner.

Each job is a row in Postgres. Every 10 seconds, pg_cron calls an Edge Function that starts renders, checks on them, and copies each finished video into private Storage. The page only watches its rows change through Realtime.

## What you'll learn

- Start a Grok Imagine render, save its `request_id`, and check on it later instead of waiting
- Claim jobs with `FOR UPDATE SKIP LOCKED`, so overlapping worker runs never start a video twice
- Run a worker on a schedule with pg_cron and pg_net, with no server to keep alive
- Copy finished videos into a private Storage bucket and play them through signed URLs
- Enforce a per-user spend cap with a Postgres trigger, so a client can't skip it

## Run it

You need Node.js 22.13 or later, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). Start in fake mode, which needs no API key. The worker pretends to render and returns a 3-second test pattern.

```bash
cd examples/imagine-video-jobs/typescript
npm install
npm run supabase:fake
npm run web
```

Open http://localhost:3102, create an account, and queue a prompt. Within 10 seconds the card goes from Queued to Rendering. Close the tab, stop `npm run web`, wait 20 seconds, then start it again and reopen the page. The video is done, because pg_cron kept the worker going while nothing else ran.

For real videos, put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`, and run `npm run supabase:start` instead of `npm run supabase:fake`. Use these two scripts rather than a bare `supabase start`, because they also save the worker's URL and key in Vault for the cron job. Let running jobs finish before you switch modes.

```bash
npm test                    # 7 end-to-end tests, needs fake mode
npm run smoke -- --image    # two 1-second real videos, billed to your key
```

A 480p video cost about $0.08 per second when we ran it. Each user can spend $3.00 by default. A new job reserves an estimate against that cap until the real cost is known.

## How it works

1. `supabase/migrations/20261016000001_generations.sql` creates `generations`, one row per job. Users can read their own rows and insert only the prompt, source photo, duration, and resolution. A trigger prices each new job, locks the user's budget row, and rejects the insert if it would pass the cap.
2. `supabase/migrations/20261016000003_worker.sql` schedules the worker every 10 seconds with pg_cron. It calls the function with `net.http_post` only when a job is queued or rendering, so an idle project makes no calls.
3. `supabase/functions/worker/index.ts` claims up to 3 queued jobs and 10 running ones with `FOR UPDATE SKIP LOCKED` and a two-minute lease. It starts new renders with `POST /v1/videos/generations` and checks the others with `GET /v1/videos/{id}`. It answers 202 right away and finishes the work with `EdgeRuntime.waitUntil()`.
4. When a render finishes, the worker copies the video into the private `videos` bucket, because the API's video URLs are temporary, and saves the real cost.
5. The page subscribes to the user's rows with Realtime, and row-level security decides which changes it receives. `src/server.ts` only serves the page, so stopping it loses nothing.

The worker calls the REST endpoints with `fetch` and takes only types from `@xai-official/sdk`, because the SDK requires Node 22.13 and Edge Functions report Node 20. If a run dies after it starts a render but before it saves the id, the job is marked failed and counted as billed, so the video is never started twice. The API can't cancel a render, so the queue has no cancel button.

## Deploy it

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy worker
supabase secrets set XAI_API_KEY=<your key>
```

In the SQL editor, tell the cron job where the worker is, with a secret key from the project's API settings:

```sql
select configure_worker('https://<ref>.supabase.co/functions/v1/worker', '<secret key>');
```

Then run the page with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` set to your project. Keep email confirmation on, which hosted projects do by default, so nobody can create free accounts to get around the cap. Set the Site URL under **Authentication > URL Configuration** to `http://localhost:3102`, so the confirmation link comes back to the page.
