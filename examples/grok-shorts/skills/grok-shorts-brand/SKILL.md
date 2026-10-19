---
name: grok-shorts-brand
description: Sets up Grok Shorts' brand kit, library, and apps, meaning the colors, font, logo, end card, and starting presenter on every video, the images, clips, and music videos can use, and the apps Grok reads from while it researches. Use when someone wants their shorts on brand, wants to add a logo, screenshots, product clips, or music, or wants Grok to read from GitHub, Slack, Notion, or Linear.
---

# Brand kit, library, and apps

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

## Brand kit

New videos start in the brand's colors and font, with its logo in the corner of every frame, its end card after the last line, and its presenter. Videos made before keep their theme until it's changed with `shorts theme <project> brand`.

- `shorts brand` shows the brand kit, or `null` when there isn't one, with the fonts and looks to pick from.
- `shorts brand website <url>` reads a brand off a website: its name, colors, font, look, a call to action with its X account, and its logo, saved as a picture to look at. Show the person what it found, then save it with `--save` only once they agree.
- `shorts brand set [--name <name>] [--colors "#ff5500,#111111"] [--text "#ffffff"] [--font <id>] [--look <theme>] [--glow on|off] [--watermark on|off] [--end-card on|off] [--end-card-line "Follow @handle"] [--presenter <id>]` changes what's given and keeps the rest. A brand kit needs at least one color, and takes up to three.
- `shorts brand logo <file>` adds a PNG, JPEG, or WebP logo, and `shorts brand remove-logo` takes it away.

## Library

Grok is told what's in the library, by name, and shows uploads wherever they show what a line is about better than anything it found.

- `shorts library` lists the uploads, each with its id.
- `shorts library add <file> [--name "<what it shows>"]` adds a PNG, JPEG, or WebP image, an MP4, MOV, or WebM video, or MP3, M4A, or WAV music, up to 300 MB. Name it for what it shows, since that's how Grok picks it.
- `shorts library remove <upload>` takes one away.

`shorts use-upload <project> <segment> <upload>` shows an upload on a segment by hand, and `shorts sound <project> --music <upload>` plays music under a video. Only add music the person has the rights to.

## Apps

Apps let Grok read a link from GitHub, Slack, Notion, Linear, or DeepWiki while it researches, through their remote MCP servers, and only ever read from them.

- `shorts apps` lists the apps, with tokens hidden, and the presets to start from.
- `shorts apps add --preset <name> --token <token>` adds one from a preset, or `--name <name> --url <https://...> [--token] [--about] [--tools <a,b>]` any other server. Adding one with the same name changes it.
- `shorts apps test <id>` checks that Grok can reach it and lists its tools. `shorts apps off <id>` and `shorts apps on <id>` turn it off and on, and `shorts apps remove <id>` forgets it.

An app's token lends its access to everyone who makes a video on that computer. When you work for several people, like a Team Bot, don't add apps: read the source with the asker's own access and pass it to `shorts draft` with `--file`, or `--pr` for a pull request.
