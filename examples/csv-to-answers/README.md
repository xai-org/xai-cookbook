---
title: CSV to Answers
seo_title: "AI Data Analyst: Ask Questions about a CSV with the Grok API"
description: Drop in a CSV and ask questions about it. Grok writes and runs pandas in a sandbox, shows the code it ran, and answers with computed numbers and a chart.
type: app
level: intermediate
languages: [typescript]
capabilities: [code-execution, files, structured-output, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# CSV to Answers

This app builds an AI data analyst with the Grok API that answers questions about a CSV by writing and running pandas code. The answers come from code that ran rather than from the model's estimate, which matters when the numbers do.

Drop in a spreadsheet and ask a question, like "which plan's churn got worse after the price change?" Grok writes pandas code, runs it in a sandbox with the code execution tool, and answers with the numbers it computed and a chart. Every program it runs shows up next to the answer with what it printed, so you can check the work. It runs as a small web app or in your terminal.

## What you'll learn

- Get computed numbers instead of estimates with the code execution tool, and require a code run before Grok answers
- Get a file into the sandbox by uploading it with the Files API and attaching it as an `input_file`
- Show the code behind an answer as it runs, from the stream's code interpreter events and its tool call outputs
- Return the answer and a chart as structured output in the same request that runs the code, and draw the chart as it streams in
- Use a low reasoning effort so a question takes under a minute instead of nearly two
- Stream progress from a Node server to a web page with server-sent events, and cancel the request when the page closes

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/csv-to-answers/typescript
npm install
npm run web
```

Open http://localhost:3000 and click one of the questions to ask it about the sample, or type your own. The questions show up again under each answer, so you can ask one after another. The page works like a data notebook. The question and Grok's answer are on the left: a short answer, the key numbers, and a chart. The notebook on the right shows the CSV, then Grok's thinking and each program it runs, with what the program printed, as it happens. Click **Stop** or close the page to cancel. To use your own data, drop a CSV of up to 2 MB anywhere on the page, or click the file name.

To ask from the terminal instead, pass a CSV and a question. Without them, it asks the question above about the sample.

```bash
npm start -- ./your-data.csv "Which month had the most refunds?"
```

That prints each program and its output as Grok runs it, then the answer with a small text chart, and saves the answer, the chart's numbers, and the code to `output/` as Markdown and JSON.

The sample, `subscriptions.csv`, is made up: 756 rows of monthly subscription numbers from January 2025 to September 2026, one row for each plan, region, and sales channel, with each month's price, customers, cancellations, and revenue. In April 2026, Plus went from $19 to $25 and Pro from $49 to $59. A question took 15 seconds to a minute when we ran it, with one or two code runs, and cost 7 to 11 cents at list prices. Each code run is billed at half a cent ($5 per 1,000), and most of the rest is input tokens, because the CSV is in Grok's context on each of its turns: a question with one run used about 42,000 input tokens. At the end, the page shows the cost the API reports.

## How it works

The shared code is in `src/answers.ts`:

1. `uploadCsv()` uploads the CSV with `client.files.upload()`. The upload deletes itself after an hour.
2. `ask()` sends the question to `grok-4.7` with `codeExecution()` and attaches the upload as `{ type: "input_file", file_id }`. The API copies an attached file into the sandbox's working directory under the name it was uploaded with, so the prompt tells Grok to read it with `pd.read_csv("subscriptions.csv")`. Without that, Grok looked for it in an `attachments` folder first and took three runs to load it. The sandbox has no network, so this is how data gets in. Sending the file inline as `file_data` puts it in the same place. Pasting the CSV into the prompt doesn't put anything on disk: Grok retyped the rows into its code, which worked for 63 rows but would take tens of thousands of output tokens for the sample.
3. The API also puts the file's text in Grok's context. The 40 KB sample takes about 19,000 input tokens, and a 167 KB file took 50,000 instead of the 80,000 its size suggests, so Grok sees only part of a big file there. The copy on disk is complete: Grok's code counted all 3,024 rows of that file. Since Grok can read the data, it can skip the code: asked for a column's total in that file, it answered without running anything and was off by more than three times. So the request sets `tool_choice: "required"`, which makes Grok run code at least once before it answers, and the prompt says to compute every number with code and print everything it will report.
4. While the response streams, each code run arrives as a few events. The SDK doesn't know the code interpreter's own events yet, so they arrive as `unknown` events, and `response.code_interpreter_call_code.done` carries the program as soon as Grok has written it. The code comes whole, not a token at a time, before it runs. When the run finishes, from under a second to a few seconds later, the `server_tool_call` event delivers the finished `code_interpreter_call`. It only has the program's output when the request asks for it with `include: ["code_interpreter_call.outputs"]`, and each output's `logs` is a JSON string with the program's `stdout`, `stderr`, and `exit_code`.
5. The answer follows a JSON schema in `text.format`, in the same request that runs the code: a short answer, two to four findings, and a chart with its type, value format, labels, series, and markers for events like the price change. The chart also names the series that answers the question, which the page draws in the accent color. When the answer is a single number, the prompt asks for a breakdown of it, so the chart has something to show. As the JSON streams in, the `json` event hands `ask()` the answer so far, so the page shows the answer first, then the findings, then the chart's lines as their values arrive.
6. The request uses a low reasoning effort. At the default effort, Grok thought for up to half a minute between runs, ran four programs, and took 103 seconds to reach the same numbers. At low effort, it took one or two runs.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first sends the CSV to `/api/datasets`, which keeps it in memory, and then opens `/api/answer` with the id it gets back for each question. The first question uploads the CSV to the Files API, and a question asked when the upload is nearly an hour old uploads it again. The server streams each step to the page as server-sent events and passes an `AbortSignal` to every API call, so closing the page or clicking **Stop** cancels the request. The SDK client uses `retryBeforeOutput`, because when the API was busy, a request sometimes failed before Grok started.

`public/index.html` is plain HTML and JavaScript. It reads the CSV itself to show a preview, shows each event as it arrives, and draws the chart as SVG. `src/index.ts` does the same work in the terminal.

The SDK covers every call this app makes. The only gap is the code interpreter's stream events, which the SDK passes through as `unknown` events with the original payload.
