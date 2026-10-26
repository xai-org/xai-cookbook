---
name: grok-shorts-make
description: Makes a short vertical video with Grok Shorts, where a lifelike presenter explains a pull request, a Slack thread, a doc, or any idea to the camera, with captions and visuals, and writes the caption to post it with. Use when someone asks for a short, a TikTok, a Reel, a YouTube Short, or a video explainer of something.
---

# Make a short

Grok Shorts has Grok research and write a script, films a presenter saying each line with Grok Imagine, and cuts the takes together with captions and visuals into a vertical video of 15 to 45 seconds. Every step is a `shorts` command that prints its result as JSON.

## Set up

Run this before the first command in a conversation. It takes a few seconds once everything is installed, and a few minutes the first time on a new computer.

```bash
cd /workspace 2>/dev/null || cd ~
[ -d xai-cookbook ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/xai-org/xai-cookbook
git -C xai-cookbook sparse-checkout set examples/grok-shorts
git -C xai-cookbook pull -q --ff-only
bash xai-cookbook/examples/grok-shorts/skills/setup.sh
```

It prints JSON. In the commands below, `shorts` means the path in its `shorts` field, usually `/workspace/bin/shorts`. If `xaiApiKey` is false, stop and ask for the `XAI_API_KEY` secret to be added.

## Make the video

1. **Pick who presents it.** `shorts options` lists the presenters, each with a personality of their own, and the personalities. Use whoever the person asks for, or the `presenter` it returns.
2. **Get the source, with the access of the person who asked.**
   - A public pull request: put its link in the message.
   - A private pull request: read it with their GitHub app, as the pull request, its files with their patches, and its commits, save them as `{"pull": ..., "files": ..., "commits": ...}`, and pass the file with `--pr`. Only `pull.html_url` and each file's `filename` and `patch` are needed.
   - A Slack thread, a doc, or an issue: read it with their own app, save the text, and pass it with `--file`.
   - An idea: describe it in the message. Grok researches it on the web and X.
3. **Write the script.**

   ```bash
   shorts draft "<the link or idea, and anything they asked for>" --presenter <id> [--personality <id or @handle>] [--pr pull.json] [--file thread.md]
   ```

   It returns `project`, the name every other command takes. For an idea, Grok may come back with `questions` and no `segments`: ask the person, then send their answers with `shorts revise <project> "<answers>"`. When nobody can answer, add `--go-ahead` to draft.
4. **Show the script.** Share the title, Grok's `note`, and each segment's line. Ask for changes with `shorts revise <project> "<what to change>"` until it's right, like "show how it works as a diagram" for a motion graphic, or "play the clip of what she said first" for a clip that plays with its own sound before the line. The grok-shorts-edit skill has everything else that can change.
5. **Preview it.** `shorts preview <project>` makes the whole video with the presenter's portrait saying each line in their voice, for a fraction of a cent. Attach the file in `video`, and say it's a preview.
6. **Get a yes for the cost.** `estimate.usd`, in what draft, revise, and show return, is what filming costs, nearly all of it. Say it plainly, like "Filming this costs about $12", and film only after the person who asked says yes.
7. **Film it.**

   ```bash
   shorts film <project> --max-usd <a little over the estimate, never more than they agreed to>
   ```

   It takes two to five minutes. A take that cuts its line off is filmed again, longer, so it can come in a little over the estimate. Takes of segments that didn't change are kept, so filming again after a change only pays for what changed.
8. **Hand it over.** Attach the file in `video`, with what goes with it:
   - `shorts caption <project> --platform shorts|tiktok|reels`: a title, a description, and hashtags.
   - `shorts cover <project>`: a cover picture, from the hook, or another moment with `--at <seconds>`.

   Say what it cost, from `cost`.

## Several at once

`shorts batch "<source>" "<source>" ... [--presenter <id>]` writes a script for each one at the same time, without stopping for questions, and previews each. Each comes back with its `project`, to change and film like any other. `shorts list` finds any video made before by its title.

## Rules

- Film, retake, or run a screen test only after a yes for its cost from the person who asked, and never raise `--max-usd` past what they agreed to.
- Never post the video anywhere. Hand back the files and let the person post it.
- Only use presenters `shorts options` lists. Making one is in the grok-shorts-presenters skill, and a real person's face and voice need their consent.
- Never read a source with someone else's access, and don't add apps with shared tokens: pass what you read with `--pr` or `--file`.
- Change videos with the commands, not by editing files in `output/`, so the web app can keep opening them.

## When something fails

A command that fails prints `{"error": "..."}` and exits with 1, and the message says what's wrong.

- `Grok is waiting for answers to its questions`: answer them with revise first.
- `fetch failed: ETIMEDOUT` on every call: the network is slow to connect. Run the commands with `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000`.
- `GitHub's rate limit is used up`: read the pull request with the person's GitHub app and pass it with `--pr`.
