---
title: Screenshot to React Component
description: Turn a screenshot of a UI into a React component styled with Tailwind, then compare the two side by side in your browser.
type: app
level: beginner
languages: [typescript]
capabilities: [image-understanding, structured-output]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Screenshot to React Component

Give it a screenshot of a user interface, and it writes a React component that recreates it, plus a page that shows the screenshot and the live component side by side.

## What you'll learn

- Send an image to Grok at high detail
- Get code back as structured output, so there's no Markdown to strip from the response
- Preview a generated component without a build step

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/screenshot-to-component/typescript
npm install
npm start -- ./your-screenshot.png
```

Without an argument it uses `sample-screenshot.png`, a pricing page. A run takes a minute or two. The component is saved to `output/<Name>.tsx`. Open `output/preview.html` in a browser to compare it with the screenshot. The preview loads React, Babel, and Tailwind from CDNs, so it needs an internet connection.

## How it works

1. The script sends the screenshot with `detail: "high"` and asks `grok-4.7` for a single TSX file styled with Tailwind classes, with rules for matching colors, sizes, and text exactly.
2. The response follows a JSON schema with the component's name and code, so the code comes back as a plain string. A `pattern` in the schema limits the name to letters and digits, because it becomes the file name.
3. `previewPage()` writes an HTML page that compiles the component with Babel in the browser and renders it next to the screenshot.
