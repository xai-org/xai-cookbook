---
title: Screenshot to React Component
seo_title: "Screenshot to Code: Generate React Components with the Grok API"
description: Turn a screenshot of a UI into a React component styled with Tailwind, then have Grok compare the result with the original and fix what doesn't match.
type: app
level: beginner
languages: [typescript]
capabilities: [image-understanding, structured-output, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-01
---

# Screenshot to React Component

This app turns a screenshot of a user interface into a React component with the Grok API, then has Grok check its work against the original. It shows how to send an image at high detail and get code back as structured output, ready to preview without a build step.

Give it a screenshot of a user interface, and it writes a React component that recreates it. A small web app shows Grok's reasoning and the code as it's written, then runs the component next to the screenshot. In a second round, the page takes a screenshot of the component, and Grok compares it with the original and fixes what doesn't line up.

## What you'll learn

- Send an image to Grok at high detail
- Get code back as structured output, so there's no Markdown to strip from the response, and show the code while it streams in
- Preview a generated component without a build step
- Send several images in one request, including an overlay that shows Grok where its component doesn't match
- Lower the reasoning effort so a round takes seconds instead of minutes
- Upload a file to a Node server and stream progress back to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/screenshot-to-component/typescript
npm install
npm run web
```

Open http://localhost:3000, then drop, paste, or open a screenshot and click **Make component**, or click **Try the sample**. The page works like a design-to-code tool. The screenshot and the component sit side by side, the code streams into an editor underneath, and each round gets an entry on the right with its score and the differences Grok fixed. Round 2 starts on its own. Switch to **Outlines** to see what Grok compares, and click **Compare again** for another round. A run takes a minute or two. The preview loads React, Babel, Tailwind, and html-to-image from CDNs, so it needs an internet connection.

To make a component from the terminal instead, pass a screenshot:

```bash
npm start -- ./your-screenshot.png
```

Without an argument it uses `sample-screenshot.png`, a pricing page. The component is saved to `output/<Name>.tsx`. Open `output/preview.html` in a browser to compare it with the screenshot. The terminal version stops after the first round, because the later rounds need a browser to take a screenshot of the component.

## How it works

The shared code is in `src/component.ts`:

1. `writeComponent()` sends the screenshot with `detail: "high"` and asks `grok-4.7` for a single TSX file styled with Tailwind classes, with rules for matching colors, sizes, and text exactly. It streams the response and reports Grok's reasoning, the component's name, and the code as they arrive.
2. The response follows a JSON schema with the component's name and code, so the code comes back as a plain string. While it streams, the stream's `json` event hands `writeComponent()` the JSON so far with the unfinished code string closed off, so it can show the code as it's written. A `pattern` in the schema limits the name to letters and digits, because it becomes the file name.
3. `componentPage()` makes an HTML page that compiles the component with Babel in the browser and renders it, with React and Tailwind loaded from CDNs.
4. `refineComponent()` runs the later rounds. It sends the original screenshot, a screenshot of the component at the same size, an overlay of the two, and the code, and asks Grok to list the differences it fixes before it returns the corrected file. The overlay traces the edges in both images, the screenshot's in blue and the component's in red, so Grok can see what's out of place instead of judging it from two separate images. Without it, Grok misreads sizes and positions, and at the default reasoning effort it spends minutes looking. With it, low effort is enough, and a round takes about 30 seconds. If the component's page is taller than the screenshot, the request also says so in pixels. A page that's too tall can't center its content, so everything moves at once, and Grok can't tell from the images that the page scrolls.

`src/server.ts` runs `writeComponent()` and `refineComponent()` for the page. `EventSource` can only make GET requests, so the page first uploads the screenshot to `/api/screenshots`, then opens `/api/component` with the id it gets back and receives each step as a server-sent event. Later rounds work the same way through `/api/refinements` and `/api/refinement`. The server stops the request if the page is closed.

`public/index.html` is plain HTML and JavaScript that shows those events and renders the finished component in a sandboxed iframe. The iframe is the screenshot's size, scaled down to fit next to it, so the component wraps the way the screenshot does, and it doesn't scroll, so it shows exactly the area that gets compared. A script added to the iframe takes a screenshot of the component with [html-to-image](https://github.com/bubkoo/html-to-image) and sends it to the page, along with how tall the component's page is. The page traces the outlines in both screenshots to draw the overlay and to score how closely they line up, giving each outline less credit the further it is from the nearest one in the other screenshot. It keeps whichever component scores best, so a round that makes things worse is undone, and the next round starts from the best one.

`src/index.ts` does the first round in the terminal and writes `preview.html`, which uses the same scaled iframe.
