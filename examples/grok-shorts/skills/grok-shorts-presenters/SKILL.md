---
name: grok-shorts-presenters
description: Makes presenters and personalities for Grok Shorts. It invents a presenter, or starts from a video of a real person who agreed to it, draws portraits, films screen tests, and saves them, and writes personalities from an idea or an X account's style. Use when someone wants a new presenter, their own face or voice in videos, a custom voice, or a new personality or style for their shorts.
---

# Presenters and personalities

## Set up

Run this before the first command in a conversation. It takes a few seconds once everything is installed.

```bash
cd /workspace 2>/dev/null || cd ~
[ -d xai-cookbook ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/xai-org/xai-cookbook
git -C xai-cookbook sparse-checkout set examples/grok-shorts
git -C xai-cookbook pull -q --ff-only
bash xai-cookbook/examples/grok-shorts/skills/setup.sh
```

In the commands below, `shorts` means the path in the `shorts` field it prints, usually `/workspace/bin/shorts`. `shorts options` lists the presenters and personalities there are.

## A new presenter

1. **Start from an idea, or from a real person.**
   - `shorts presenter invent ["<idea>"]` makes someone up: a first name, how they look, where they film, a voice, and a line in their voice. Without an idea it's a surprise.
   - `shorts presenter from-video <video> --consent [--at <seconds>] [--clone-voice --name <name>]` reads a video of a real person: whoever is talking at `--at`, or else whoever talks the most, with four frames of them, a sample of their voice, and how they look and where they are. The video itself isn't kept. Ask first, every time: "Is this you, or did they agree to have their face and voice used?", and pass `--consent` only after a clear yes. `--clone-voice` makes a custom voice from the sample, which takes an Enterprise plan. Without one, `voiceError` says so: pick a voice from `shorts voices` instead.
2. **Hear voices.** `shorts voices` lists the voices, and `shorts speak "<line>" --voice <id>` says a line in one, for a fraction of a cent.
3. **Draw portraits.** `shorts presenter portraits --look "<how they look>" --room "<where they film>"`, or `--likeness <frame>` with one of from-video's frames, draws four portraits for 16 to 25 cents. Attach them and let the person pick one. Skip any with words or app buttons drawn in.
4. **Screen test.** `shorts presenter screen-test <portrait> --voice <id> --room "<where they film>" [--line "<line>"] [--delivery "<how they act>"]` films a few seconds of them saying the line, for about 70 cents. Get a yes first, then attach it.
5. **Save them.** `shorts presenter save --portrait <portrait> --name <name> --look "<how they look>" --room "<where they film>" --voice <id> [--personality <id>]` saves them for every video, under the `id` it returns. `shorts presenter save --id <presenter> [--name] [--voice <id>] [--personality <id>]` changes a presenter already saved, or a built-in one, without new portraits.

Portraits and frames have to be ones the studio made, from the paths these commands return.

## A new personality

A personality is how a presenter's lines are written, and how they act them out on camera.

1. `shorts personality write ["<idea or @handle>"]` writes one: a name, a summary, how they talk with example lines, and how they act on camera. With an X handle, Grok reads the account's posts and copies its style, never its name. Save what it prints to a file.
2. `shorts personality lines --file personality.json [--topic "<topic>"]` writes the hook, a beat, and the ending of a video in it, to try it out, and `shorts speak` says them.
3. `shorts personality screen-test --presenter <id> --line "<line>" --delivery "<how they act>"` films a presenter acting a line in it, for about 70 cents, after a yes.
4. `shorts personality save --file personality.json` saves it, with any part changed by `--name`, `--summary`, `--style`, or `--delivery`. Its `id` goes with `--personality` on draft, revise, and presenter save.

## Rules

- A real person's face and voice only with their consent, confirmed each time.
- Presenters are always adults, and never a real person by name unless it's them, or they agreed.
- Get a yes for anything that costs more than a few cents: portraits and screen tests.
