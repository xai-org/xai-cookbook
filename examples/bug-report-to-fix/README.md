---
title: Bug Report to Fix
description: Describe a bug in a small repo, and watch Grok read the code, reproduce the bug with a failing test, fix it, and rerun the tests, with every command checked before it runs.
type: app
level: advanced
languages: [typescript]
capabilities: [shell, function-calling, streaming, reasoning, prompt-caching, compaction]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Bug Report to Fix

Describe a bug in tiny-checkout, a small sample repo, and Grok fixes it the way a developer would: it reads the repo's instructions, finds the code behind the symptom, adds a test that fails, edits the code, and reruns the tests until they pass. Every command Grok writes runs in a fresh copy of the repo. Commands on an allowlist run right away, and anything else waits for you to click Approve or Deny. A small web app streams the commands and their output into a terminal while the diff fills in beside it.

## What you'll learn

- Run a tool loop: run each call as soon as it streams in, send the outputs back, stop when a turn makes no calls, and cap the number of turns
- Handle the shell tool, which sends commands as `shell_call` items and expects a `shell_call_output` with one result per command
- Run commands a model wrote: in a scratch copy of the repo, checked against an allowlist without a shell, with a timeout, an output limit, and a person's approval for anything else
- Give Grok a skill through the shell tool's `environment.skills`, so it learns how the repo runs its tests and what its conventions are
- Let Grok edit files through a function tool that can only write inside the scratch copy
- Keep a long session fast and cheap with `prompt_cache_key`, and compact it with `responses.compact()` once its input passes a threshold
- Stream the run from a Node server to a web page with server-sent events, and send the page's Approve or Deny back to the run

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/bug-report-to-fix/typescript
npm install
npm run web
```

Open http://localhost:3000 and click one of the three bug reports, or describe your own and click **Fix it**. The page works like a coding tool. The bug report and a list of turns sit on the left, with how many input tokens each turn sent and how much of it was cached. The terminal in the middle shows Grok's reasoning, each command and its output, and Grok's notes as it goes. The repo on the right marks each file Grok reads, and shows a diff of each file it changes. When a command isn't on the allowlist, the terminal shows it with **Approve** and **Deny**. At the end, the page shows whether the tests pass, what the run cost, and a link to download the fix as a patch. Click **Stop** or close the page to cancel the run.

To fix a bug from the terminal instead, pass the number of a sample report or your own description. Without an argument it uses the first sample.

```bash
npm start -- 2
npm start -- "A sticker priced at \$0.29 shows up in the cart as \$0.28"
```

The terminal asks before running a command that isn't on the allowlist. Both versions save each run to `output/<time>-<report>/`: the fixed copy of the repo in `repo/`, and the changes in `fix.patch`, which `git apply` can apply to `sample-repo/`. The sample reports in `sample-bugs.json` each describe a real bug in `sample-repo/`. A run takes 7 or 8 turns and 40 to 50 seconds, and cost 3 to 5 cents when we ran it.

## How it works

The shared code is in `src/agent.ts`, which runs the loop, and `src/workspace.ts`, which runs the commands. `fixBug()` takes a bug report and reports each step through callbacks, so the web app and the terminal app show the same run in their own way:

1. `createWorkspace()` copies `sample-repo/` to a new folder under `output/`. Every command runs there, and `write_file` can only write there.
2. Each turn streams a `grok-4.7` request with two tools: the built-in `shell` tool, and `write_file`, a function tool. The stream's `client_tool_call` event hands over each call as soon as its arguments are complete, and `fixBug()` runs it right away, one call after another, since a test run right after an edit has to see the edit. When the turn ends, the model's output and the results go into the next request's input. A turn without tool calls ends the run, and so does the 25th turn.
3. A `shell_call` holds a list of commands in `action.commands`. `checkCommand()` splits each one into words the way a shell would, and turns it away if it uses anything only a shell understands, like a pipe, a redirect, a glob, or a variable. The rest has to match the allowlist: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `find`, and `pwd` with known flags and every path inside the copy, even after following symbolic links, plus `node --test` and `npm test`. `runCommand()` runs an allowed command without a shell, with a 20-second timeout and up to 10,000 characters of each output stream, and without this process's environment, which holds the API key. The tests run Grok's code, so they run under Node's permission model, which lets them read and write the copy and nothing else, and blocks child processes. A command off the allowlist goes to the `approve` callback. If you approve it, it runs through `/bin/sh` in the copy. If you deny it, Grok gets a result saying so, and why it needed approval. The results go back as one `shell_call_output` per call, with one entry per command.
4. Grok changes files only with `write_file`. Shell commands could write files too, with `sed -i` or a redirect, but then the app would have to work out from each command whether it writes and where. `write_file` takes a path and the file's full content, resolves the path, and refuses anything outside the copy or behind a symbolic link. Full content is simple and safe for files this small. For a large codebase, a tool that replaces one passage at a time would save output tokens. After each call, `repoChanges()` compares the copy with `sample-repo/`, and `src/diff.ts` turns each changed file into a unified diff. That catches changes from approved commands too.
5. The sample repo carries a skill in `skills/fix-a-bug/SKILL.md`: how to run the tests, where the code and tests live, the steps every fix follows, and the repo's conventions. `fixBug()` reads the name and description from its front matter and lists it in the shell tool's `environment.skills` with its path. That's all Grok sees of it until it reads the file through the shell tool, which is why `cat` inside the copy is on the allowlist.
6. Every request in a run sends the same `prompt_cache_key`, which routes it to the server that has the start of the conversation cached, and the input only ever grows at the end, so that start stays the same. From the fourth turn or so, most turns had 80 to 99 percent of their input cached, and cached tokens cost a quarter of the price. A cache entry can still be dropped, so now and then a turn shows almost none. Once a request's input passes 20,000 tokens, `compact()` sends everything before the latest turn to `responses.compact()` and continues from the single encrypted item it returns, with the latest turn added after it. A sample run stays under 6,000 tokens, so it doesn't compact. Compaction trades detail for size: in a test with the threshold at 3,000 tokens, the summary lost the repo's file names, and Grok went on to plan an edit to a file that doesn't exist. Compact only once a session is long.
7. When Grok stops, `fixBug()` runs the tests once more itself instead of trusting Grok's summary, and saves the changes as `fix.patch`.

Grok uses medium reasoning effort. At low effort, it skipped the skill's steps and wrote the fix and the test in the same turn, so the test never failed first. At medium, a turn takes a few seconds and Grok follows the steps. The client retries requests that fail before Grok has streamed anything, since a failed turn would end the run. Each turn's cost is worked out from its token counts and the prices that `client.models.language.get()` returns, because the response from `responses.compact()` doesn't include a cost.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first sends the bug report to `/api/runs` and then opens `/api/events` with the id it gets back, which works only once, so a reconnecting `EventSource` can't start a second run. The server runs `fixBug()` and sends each step to the page as a server-sent event. When a command needs approval, it sends the page a random token, and the page posts Approve or Deny with it to `/api/approvals`. It passes an `AbortSignal` to every request and command, and aborts it when the page closes, which also denies any command still waiting. It serves `fix.patch` only for runs it made. `public/index.html` is plain HTML and JavaScript that shows those events. It loads [Prism](https://prismjs.com) from a CDN to color the code in the diffs, and shows plain code without it. `src/index.ts` does the same work in the terminal.

The app has no dependencies besides the SDK. Node has no diff built in, so `src/diff.ts` has a short one, which is enough for files this small.

### What this doesn't protect against

The allowlist, the permission model, and the stripped environment make mistakes unlikely to leave the copy, but this isn't a sandbox. Node's permission model doesn't restrict the network in Node 24, so test code can still make requests. A command you approve runs through the shell with your user's permissions. To run an agent like this on code you care about, run the commands in a container or a virtual machine.

### Next steps

- The Responses API also has a [WebSocket mode](https://docs.x.ai/developers/advanced-api-usage/websocket-mode), where each turn sends only its new items on one open connection, which saves time over many turns. The SDK doesn't support it yet, so this app sends each turn as an HTTP request.
- Swap `sample-repo/` for your own project and rewrite its skill. A bigger codebase will want a tool that edits one passage at a time instead of `write_file`.
