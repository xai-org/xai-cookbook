---
title: Docs to Cited Answers
seo_title: "RAG with Citations: Answer from Your Documents with the Grok API"
description: Ask questions about a folder of documents and get answers that cite the passages they came from, with a metadata filter that decides which documents count.
type: app
level: intermediate
languages: [typescript]
capabilities: [collections, files, structured-output, streaming]
models: [grok-4.7]
env: [XAI_API_KEY, XAI_MANAGEMENT_API_KEY]
icon: document-search
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Docs to Cited Answers

This app builds a document Q&A assistant with the Grok API that answers questions from your own files, with citations. It's the pattern to reach for when answers have to be checkable, like support articles, policies, or an internal handbook.

Upload a folder of documents to a collection and ask questions about them. A search finds the passages that match, and Grok answers only from those passages, citing each one and quoting the sentence it relied on, so you can check every answer. A metadata filter decides which documents count, and a question the documents don't answer gets "I couldn't find that in your documents." It runs as a small web app or in your terminal, and comes with a short handbook for a made-up outdoor store and a 20-question eval.

## What you'll learn

- Create a collection with metadata fields, and add documents to it with their fields
- Search a collection with an AIP-160 filter like `version="2026"`, so only some documents count
- Have Grok quote the passages before it answers, and check each quote against its passage
- Say "I couldn't find that in your documents." instead of guessing
- Stream structured output, and show the quotes and the answer as they arrive
- Measure the search and the citations with a small eval

## Run it

You need Node.js 22.13 or later and two keys:

- `XAI_API_KEY`, your API key, which uploads files, searches, and asks Grok.
- `XAI_MANAGEMENT_API_KEY`, a management key, which creates the collection and adds the documents to it. Creating collections and adding documents goes through the [Management API](https://docs.x.ai/developers/management-api-guide), which doesn't accept API keys. Make one in the [SpaceXAI Console](https://console.x.ai) under Settings, then Management Keys. Give it the `AddFileToCollection` permission, and the permissions in the Collections Endpoint group for creating collections and reading their documents. Make it in the same team as your API key, because the files are uploaded with one key and added to the collection with the other. Only `npm run ingest` uses it.

Put both in `.env` at the root of the repo, or export them. Then upload the sample handbook:

```bash
cd examples/docs-to-cited-answers/typescript
npm install
npm run ingest
```

That creates a collection named `handbook`, adds the six documents in `handbook/` with the fields listed in `handbook/metadata.json`, waits until they can be searched, and saves the collection's ID to `output/collection.json`. It takes about 15 seconds. Each run creates a new collection, which you can delete in the console.

Then start the web app:

```bash
npm run web
```

Open http://localhost:3000, and pick a question or type one and click **Ask**. The page works like a document assistant. On the left, the filter decides which documents count, and the documents it leaves out fade in the library below it. In the middle, Grok's reasoning shows under the question while it reads, and then the answer streams in with numbered citations. On the right are the passages the search found, with their file, relevance score, and fields, and the sentence Grok quotes from each one lights up as Grok copies it. Point at a citation to see its passage. Ask whether a sale item can be returned after 30 days under `version="2025"` and then under `version="2026"`, and the answer changes from yes to no. Click **Stop** or close the page to cancel.

To ask from the terminal instead:

```bash
npm start -- "Can I return a sale item after 30 days?" --filter 'version="2025"'
```

The filter defaults to `version="2026"`, and `--filter ""` searches every document. The answer, its quotes, and its passages are saved to `output/answers/`.

An answer takes 3 to 8 seconds: about half a second for the search, a few seconds of reasoning, and then the quotes and the answer. Grok reads about 1,100 tokens and writes 150 to 350, most of them reasoning, which comes to about $0.003 at `grok-4.7`'s list prices. The page and the terminal show the token count and the cost the API reports for each answer. The search doesn't report a cost of its own.

To use your own documents, put them in a folder with a `metadata.json` that gives each file a `version` and a `team`, like the one in `handbook/`, and run `npm run ingest -- path/to/folder`. To use other fields, change `FIELDS` in `src/ingest.ts`. The page builds its filter buttons from whatever fields the documents have.

## How it works

`src/ingest.ts` creates the collection with `POST /v1/collections` on the Management API, with two fields in `field_definitions`, `version` and `team`. Both are required, so a document without them is rejected. Adding a document takes two steps: `client.files.upload()` uploads the file with the Files API, and `POST /v1/collections/{collection_id}/documents/{file_id}` adds it to the collection with its fields. The script then checks each document until its status is `DOCUMENT_STATUS_PROCESSED`. The collection splits documents into chunks of 500 characters, about one section of a policy each, instead of the default 4,000 bytes, which would make each of these short policies a single passage. The SDK doesn't cover the Management API, so these calls use `fetch`.

The shared code is in `src/answers.ts`. `answer()` runs two steps and reports each one through callbacks, so the web app and the terminal show the same progress in their own way:

1. `searchDocuments()` sends the question, the collection's ID, and the filter to `POST /v1/documents/search` and gets back the six best passages. Each one has its text, its file, a relevance score, a page number, and the document's fields. The search mixes keyword and semantic matching by default. The filter uses [AIP-160](https://docs.x.ai/developers/files/collections/metadata) syntax: `version="2026"`, `team="Finance" AND version="2026"`, or `version="2025" OR team="People"`. Values match exactly, and a filter on a field no document has matches nothing. The SDK has no method for this endpoint either, so it's a `fetch` with your API key. If no document matches the filter, the app answers "I couldn't find that in your documents." without asking Grok.
2. `writeAnswer()` numbers the passages and sends them to `grok-4.7` with a JSON schema in three parts: the quotes, each the number of a passage and words copied from it; whether the passages answer the question; and the answer, with the number of a passage in brackets after each fact. Quotes come first so Grok picks out the evidence before it writes. As the JSON streams in, the `json` event hands over the output so far, which is how the page highlights each quote while Grok copies it. Grok writes the fields in the schema's order, so the quotes are finished once the answer starts, and the app checks them before it shows any of the answer. A quote counts only if it's in its passage word for word, apart from spacing, case, and curly quotes. An answer needs at least one quote that counts, or the app says "I couldn't find that in your documents." instead. It uses a low reasoning effort, because copying quotes out of six short passages doesn't need more, and low effort starts quoting within a few seconds.

Grok also has a built-in search tool, `collectionsSearch()`, which lets it search a collection on its own. This app doesn't use it, because the API rejects `filters` on it with `Argument not supported: filters`, so it can't leave any documents out. Its results have the text and score of each passage, but not the page number or the fields, and the file name came back empty when we tried it. Searching first and handing the passages to Grok also makes the search the same every time, which is what the eval checks.

`src/server.ts` runs `answer()` for the page and streams each step to it as server-sent events. It passes an `AbortSignal` to every request, so closing the page or clicking **Stop** cancels the search or the answer. It also serves `output/collection.json`, from which the page builds the library and the filter buttons. `public/index.html` is plain HTML and JavaScript. A filter made of `key="value"` pairs joined by `AND` selects the matching buttons and fades the documents it leaves out. Anything else, like `OR` or `!=`, goes to the search as typed. `src/index.ts` does the same work in the terminal.

`npm run eval` runs `src/eval.ts`, which asks the 20 questions in `eval.json`, four at a time. Seventeen of them name the file and a phrase that the right passage contains. For those, the eval checks where that passage ranks in the search results, and whether the answer cites it, with a number in brackets or a quote that counts. The other three have no answer in the documents their filter allows, like a student discount, or a sale item return under `team="Finance"`, and pass only if the answer is "I couldn't find that in your documents." When we ran it, every search returned the right passage as its top match, every answer cited it, and all three questions without an answer got "I couldn't find that". A question whose request fails, for example because of a rate limit, is left out of the totals and listed at the end. A run takes 25 to 45 seconds and uses about 25,000 tokens, about 6 cents at list prices. It saves the results to `output/eval.json`.

The search returns a `page_number` for each passage, which it documents as 0 for single-page documents. For the two-page PDF in the sample handbook it returned 0 for every passage too, so the page shows a page number only when the search reports one.
