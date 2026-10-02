---
title: Screenshot to React Component
description: Turn a screenshot of a UI into a React component styled with Tailwind, and watch the code being written and the component running next to the screenshot in a small web app.
type: app
level: beginner
languages: [typescript]
capabilities: [image-understanding, structured-output, streaming]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Screenshot to React Component

Give it a screenshot of a user interface, and it writes a React component that recreates it. A small web app shows Grok's reasoning and the code as it's written, then runs the component next to the screenshot so you can compare them.

## What you'll learn

- Send an image to Grok at high detail
- Get code back as structured output, so there's no Markdown to strip from the response, and show the code while it streams in
- Preview a generated component without a build step
- Upload a file to a Node server and stream progress back to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/screenshot-to-component/typescript
npm install
npm run web
```

Open http://localhost:3000, then choose a screenshot, or drop or paste one, and click **Make component**. To use the sample, click **Try the sample**. The page shows Grok's reasoning, then the code as it's written, and when Grok is done, the component running next to the screenshot. A run takes a minute or two. The preview loads React, Babel, and Tailwind from CDNs, so it needs an internet connection.

To make a component from the terminal instead, pass a screenshot:

```bash
npm start -- ./your-screenshot.png
```

Without an argument it uses `sample-screenshot.png`, a pricing page. The component is saved to `output/<Name>.tsx`. Open `output/preview.html` in a browser to compare it with the screenshot.

## How it works

The shared code is in `src/component.ts`:

1. `writeComponent()` sends the screenshot with `detail: "high"` and asks `grok-4.7` for a single TSX file styled with Tailwind classes, with rules for matching colors, sizes, and text exactly. It streams the response and reports Grok's reasoning, the component's name, and the code as they arrive.
2. The response follows a JSON schema with the component's name and code, so the code comes back as a plain string. While it streams, the code is an unfinished JSON string, so `writeComponent()` decodes it up to the last complete character. A `pattern` in the schema limits the name to letters and digits, because it becomes the file name.
3. `componentPage()` makes an HTML page that compiles the component with Babel in the browser and renders it, with React and Tailwind loaded from CDNs.

`src/server.ts` runs `writeComponent()` for the page. `EventSource` can only make GET requests, so the page first uploads the screenshot to `/api/screenshots`, then opens `/api/component` with the id it gets back and receives each step as a server-sent event. The server stops the request if the page is closed. `public/index.html` is plain HTML and JavaScript that shows those events and renders the finished component in a sandboxed iframe. The iframe is as wide as the screenshot and scaled down to fit next to it, so the component wraps the way the screenshot does. `src/index.ts` does the same work in the terminal and writes `preview.html`, which uses the same scaled iframe.
