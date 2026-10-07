# Patient intake web app

The browser front end for the patient-intake voice agent, backed by the `xai-patient-intake`
worker in [`../agent`](../agent). Run the worker first — this app dispatches it.

The landing page shows the agent card. Clicking it morphs the card into a live conversation panel
— transcript, tool calls, mic controls — connected to the deployed agent.

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill in the three LiveKit values
pnpm dev
```

## Configuration

Three environment variables, all server-side:

| Variable              | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| `LIVEKIT_URL`         | `wss://<project>.livekit.cloud` for the project hosting the agent |
| `LIVEKIT_API_KEY`     | API key for that project                                          |
| `LIVEKIT_API_SECRET`  | API secret for that project                                       |

The browser never sees these. `app/api/agent/connection_details/route.ts` mints a short-lived
participant token with an explicit agent dispatch, so the worker named in the token joins the room
the visitor just created.

**The worker must be deployed to the same LiveKit project as those credentials.** 

## Adding another agent

The single card is data, not structure — the page renders whatever `AGENTS` holds.

1. Add an entry to `AGENTS` in `app/(showcase)/_components/agent-metadata.ts`. Its `name` is the
   public identifier and its slug is the URL (`patient_intake` → `/patient-intake`).
2. Map that name to the deployed worker name in `AGENT_DISPATCH_NAMES` in
   `app/api/agent/connection_details/route.ts`. This is an allowlist — a name that isn't in it is
   rejected with a 400, so a visitor can't dispatch an arbitrary worker in your project.
3. Optionally give it an accent colour in `app/(showcase)/_components/agent-themes.ts`. Agents
   without one use the default cyan.

Cards lay out as a centered row, so a second or third agent needs no layout change.

## How this relates to livekit.com

The components under `app/(showcase)/_components`, `components/agents-ui`, `components/ui`, and
`hooks/agents-ui` are copied from `apps/www` in the `livekit/web` monorepo. They are not a
rewrite — the intent is that a diff against the originals stays readable. The deliberate
differences:

- **Routing.** The showcase is the whole site, so an agent sits at `/patient-intake` rather than
  `/agents/patient-intake`, and the page fills the viewport instead of reserving room for the
  marketing header and footer.
- **Layout.** livekit.com pins cards into a three-column grid that only centers correctly at
  exactly three. Here they are a centered row that works at any count.
- **Unknown agents.** livekit.com falls back to its homepage agent; this app returns a 400. There
  is no general-purpose agent to fall back to, and silently connecting someone to the wrong agent
  is worse than an error.

`@repo/bytes-core` and `@repo/bytes-react` are workspace-private and can't be installed here, so
the slice this page uses is vendored:

- `styles/bytes-colors.css`, `styles/bytes-core.css`, `styles/bytes-react.css` — the design token
  layer, copied verbatim. `styles/tailwind.css` is `apps/www`'s entry point with its
  monorepo-only imports removed.
- `components/bytes/` — `Button` copied as-is; `Badge` and `IconButton` reproduced with their
  class strings intact but their unused `ToggleTip` paths dropped.
- `lib/utils.ts` — the `cn` from bytes-react, whose extended tailwind-merge config is load
  bearing. Under a plain `twMerge` the badge's `text-mono-caps` loses to the `text-xs` from its
  size variant and the badge renders in sans sentence case.

To refresh against upstream, re-copy the files and re-apply those differences.

## Smoke test

`scripts/smoke-test.mjs` drives a real browser through the whole path — card, click, token,
dispatch, and the agent's opening line — and fails loudly if the agent never speaks. It needs
Playwright, which is deliberately not a dependency of this app so it stays out of Vercel builds:

```bash
pnpm add -D playwright && pnpm exec playwright install chromium
pnpm dev &
node scripts/smoke-test.mjs           # or BASE=https://your-deployment.vercel.app
```
