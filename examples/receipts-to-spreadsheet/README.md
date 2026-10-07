---
title: Receipts to Spreadsheet
seo_title: "AI Receipt Scanner: Receipts to a Spreadsheet with the Grok API"
description: Turn receipt photos and PDF invoices into a spreadsheet that adds up, with Grok reading each one twice and flagging the cells where the reads disagree.
type: app
level: intermediate
languages: [typescript]
capabilities: [image-understanding, files, structured-output, streaming, batch]
models: [grok-4.7, grok-4.3]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Receipts to Spreadsheet

This app builds an AI receipt scanner with the Grok API that extracts receipts and invoices into a spreadsheet. It shows how to validate structured output beyond what a schema can check, and how to flag the cells worth a second look.

Drop in receipt photos and PDF invoices, and get a spreadsheet where every row checks out: the line items add up to the subtotal, the subtotal, tax, and tip add up to the total, dates parse, and currencies are real codes. Grok reads each receipt twice, and the cells where the two reads disagree turn yellow for you to check.

## What you'll learn

- Validate structured output with a Zod schema through the SDK's `toJson(schema)`, and send the problems back to Grok for a second look when it fails
- Check rules that a JSON Schema can't express, like line items and tax that must add up to the total
- Get a confidence signal from two independent reads, since `grok-4.7` doesn't return logprobs
- Send PDFs through the Files API and photos as images, and stream the JSON so cells fill in as Grok writes them
- Read large sets with the Batch API
- Stream progress from a Node server to a web page with server-sent events

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/receipts-to-spreadsheet/typescript
npm install
npm run web
```

Open http://localhost:3000 and click **Read the samples**, or drop your own photos and PDFs on the page. The page works like a spreadsheet. Each receipt gets a row, and its cells fill in as Grok reads it, with the receipt, its line items, and its checks on the right. When both reads are in, a row either checks out or needs a review: yellow cells are where the reads disagree, and red ones fail a check. Click a cell to see both reads in the formula bar and pick one, or double-click it to type the right value. A line that both reads missed can be added under the line items. The row is checked again, and the totals at the bottom update. **Export CSV** downloads the sheet with your fixes.

To read receipts from the terminal instead, pass the files:

```bash
npm start -- ./receipt.jpg ./invoice.pdf
```

Without arguments it reads the eight receipts in `samples/`. It prints each row as it's done and saves `output/receipts.csv`, plus `output/receipts.json` with the line items and every disagreement. Reading the eight samples took between 20 and 50 seconds, depending on how busy the API was, and cost 7 to 10 cents when we ran it. The page and the terminal show the cost at the end.

For a large set, turn on **Batch API** on the page, or pass `--batch` in the terminal. Two receipts took about 35 seconds and cost about 2 cents at the published batch price, but a batch can take up to a day.

Zod is the one dependency besides the SDK. Node has no schema validator built in, and `toJson(schema)` accepts any [Standard Schema](https://standardschema.dev) validator, Zod included.

The samples are made up. Five were written as HTML and rendered to PNG and PDF with headless Chrome, and the three photos were made with `grok-imagine-image-2.0`. A few have problems that real receipts have: a salsa stain over a price, a tip line left blank with only the total written in, and a Canadian date, 05/10/26, that could be May 10 or October 5.

## How it works

The shared code is in `src/receipts.ts`:

1. `Receipt` is a Zod schema with the vendor, date, currency, line items, subtotal, tax, tip, and total. `z.toJSONSchema()` turns it into the JSON Schema that the API holds Grok's output to, so the output always parses and has the right shape. The rules a JSON Schema can't express are Zod refinements, which the API never sees: the currency is a real ISO 4217 code, each line's amount is its quantity times its price, the lines add up to the subtotal, and the subtotal, tax, and tip add up to the total. Amounts only have to match to the smallest unit of the currency, since receipts round.
2. `prepare()` passes a photo to Grok as an image at high detail. A PDF is uploaded with `client.files.upload()` and passed as an `input_file`, and the upload deletes itself after an hour.
3. `readOnce()` streams one read from `grok-4.7` and validates it with `response.toJson(Receipt)`, which runs the schema and its refinements and throws with each problem and its path. If it throws, the problems go back to Grok with the conversation so far, from `response.toInput()`, with a request to look again: to fix anything it misread, but to keep what the receipt really says. On the stained taqueria receipt, a first read often leaves out the hidden price, the subtotal check catches it, and the second look usually works the price out from the subtotal. A read that still fails is kept with its problems.
4. `readReceipt()` makes two reads at the same time. `grok-4.7` doesn't return logprobs, so agreement stands in for confidence: each read is sampled on its own, so where Grok is sure the reads match, and where it isn't they tend to differ. `compareReads()` shows the read with fewer problems and lists every field that differs, ignoring case, spacing, and punctuation. It pairs up the line items by name or amount first, so a line that only one read found is flagged on its own instead of shifting every line after it.
5. `readReceipts()` reads three receipts at a time and reports each step: the JSON so far from the stream's `json` event, the reasoning, each retry, and each finished row.

The reads use a low reasoning effort. Receipts are short, and the checks catch the misreads that more reasoning would. At the default effort, a read took about three times as long.

On the samples, the two reads agree on nearly everything, because Grok reads clear print the same way every time. They split where a receipt is truly ambiguous: the line under the salsa stain, the Canadian date, and whether the `X 2` in `WOOD SCREWS #8 X 2` is a quantity or the screws' length. Misread numbers mostly show up as failed checks instead, since the arithmetic catches them.

`src/batch.ts` sends both reads of every receipt as one Batch API job with `client.batches`, checks on it every five seconds, and reports each receipt as soon as both its reads are back. `grok-4.7` doesn't take batch requests, so batch mode uses `grok-4.3`, which also reads images and PDFs. Batch results come back in the Chat Completions format, so they're checked with the same Zod schema directly instead of through `toJson()`. A read that fails isn't retried, because a second round would wait in the queue again.

`src/server.ts` is a small `node:http` server. `EventSource` can only make GET requests, so the page first uploads each file to `/api/receipts` and then opens `/api/read` with the ids it gets back. The server streams each step to the page as a server-sent event, and closing the page or clicking **Stop** aborts every request, or cancels the batch. When you edit a cell, the page posts the receipt to `/api/check`, which runs the same Zod schema. `public/index.html` is plain HTML and JavaScript that shows those events as a spreadsheet. `src/index.ts` does the same work in the terminal.

The cost at the end adds up what the API reports for every read: `usage.cost_usd` on each response, or `cost_in_usd_ticks` on each batch result, ten billion to the dollar.
