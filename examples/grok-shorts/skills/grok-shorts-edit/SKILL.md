---
name: grok-shorts-edit
description: Changes a Grok Shorts video the way its studio does, with notes on moments of the video, Grok's review, the hook lab, lines, layouts, themes, the order of beats, trims, takes and retakes, music, versions, and the cover. Use when someone wants to change, fix, re-cut, or polish a short that Grok Shorts made.
---

# Edit a short

## Set up

Run this before the first command in a conversation. It takes a few seconds once everything is installed.

```bash
cd /workspace 2>/dev/null || cd ~
[ -d xai-cookbook ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/xai-org/xai-cookbook
git -C xai-cookbook sparse-checkout set examples/grok-shorts
git -C xai-cookbook pull -q --ff-only
bash xai-cookbook/examples/grok-shorts/skills/setup.sh
```

In the commands below, `shorts` means the path in the `shorts` field it prints, usually `/workspace/bin/shorts`.

## Find the video

`shorts list` lists every video, newest first, with its `project`. `shorts show <project>` returns the video as it is: each segment, numbered from 1, with its line, layout, what it shows, and whether its take is filmed, the sound, how many notes wait to go to Grok, and every version, numbered from 1, with the current one marked.

## Say what should change

- **Ask Grok:** `shorts revise <project> "<what to change>"`. Grok writes the script again, changing only what's asked and keeping every other line word for word.
- **Notes on the video:** `shorts note <project> "<what should change>" --at <seconds> [--x <0 to 1>] [--y <0 to 1>]` pins a note on the latest version, at a spot on the frame given as shares of its width and height from the top left. Notes go with the next `revise`, each with a picture of its moment, and `revise` with no message sends just the notes. `shorts notes <project>` lists them, and `shorts remove-note <project> <id>` takes one away.
- **Grok's review:** `shorts review <project>` has Grok watch the latest version and pin a note on each problem a viewer would notice, like a caption over the presenter's mouth, for a few cents. Tell the person what it found, remove the notes they disagree with, and `revise` to fix the rest.
- **The hook lab:** `shorts hooks <project>` scores the hook from 1 to 10 for how likely it is to stop someone scrolling, and writes four others, each scored. `shorts speak "<hook>" --presenter <id>` says one in the presenter's voice. Use one with `shorts line <project> 1 "<hook>"`.

## Change it by hand

Grok hears about each of these with the next message, and keeps them.

- `shorts line <project> <segment> "<line>"`: what the segment says.
- `shorts layout <project> <segment> <layout>`: how it's framed. `shorts options` lists the layouts and what each one shows.
- `shorts theme <project> <theme>`: the colors and lettering on screen. It films nothing new.
- `shorts move <project> <segment> <to>` and `shorts drop <project> <segment>`: reorder or take out a beat. The hook and the ending stay where they are.
- `shorts trim <project> <segment> [--head <seconds>] [--tail <seconds>]`: cut more from the start or end of its take, up to 3 seconds, or keep up to a second more with a negative number. It films nothing new.
- `shorts use-upload <project> <segment> <upload>`: show an image or video from the library. The grok-shorts-brand skill adds uploads.
- `shorts sound <project> [--music <upload>|none] [--volume <0 to 1>] [--effects on|off]`: music from the library under the voice, and sound effects. It films nothing new.
## Film the changes

`shorts changes <project>` lists what changed since the current version and which changes need new takes, and `shorts estimate <project>` what filming them costs. A new line, mood, or presenter, or a layout to or from a green screen, needs new takes, and so does the presenter's reaction to a clip that plays first, which a green screen films in front of it. Everything else only cuts the video again, for nothing. Then `shorts preview <project>`, or, after a yes for the cost, `shorts film <project> --max-usd <cap>`. Filming keeps the take each unchanged segment used.

## Takes

- `shorts takes <project>` lists each segment's takes by letter, with the one the next cut uses, and what retaking it costs.
- `shorts pick-take <project> <segment> <letter>` uses another of its takes, for nothing.
- `shorts retake <project> <segment> "<direction>" --max-usd <cap>` films two more takes of that line with a direction, like "more energy" or "slower", and keeps the best. It costs its `retakeUsd`, so get a yes first.

## Versions and the cover

Every cut is kept as a version. `shorts restore <project> <version>` makes an earlier one the video again, with the script it was filmed from. A preview can't become the video: film it. `shorts cover <project> [--at <seconds>] [--version <n>]` saves a frame as a cover picture, from the hook unless `--at` says otherwise.

## Rules

- Film or retake only after a yes for the cost from the person who asked, and never raise `--max-usd` past what they agreed to.
- Never post the video anywhere. Hand back the files.
- Change videos with the commands, not by editing files in `output/`, so the web app can keep opening them.
