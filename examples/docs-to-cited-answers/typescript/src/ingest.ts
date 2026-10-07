import { openAsBlob } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SpaceXAI } from "@xai-official/sdk";
import { COLLECTION_FILE, type Collection } from "./answers.ts";

const client = new SpaceXAI();

// Creating collections and adding documents to them goes through the Management API, which takes a
// management key instead of an API key. The SDK doesn't cover it, so these calls use fetch.
const MANAGEMENT_API = "https://management-api.x.ai/v1";
const TYPES: Record<string, string> = { ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf" };

// Every document says which version of the handbook it belongs to and which team owns it, so a search
// can be limited to either one. Uploads without them are rejected.
const FIELDS = [
  { key: "version", description: "The year of the handbook the document belongs to", required: true, unique: false, inject_into_chunk: false },
  { key: "team", description: "The team that owns the document", required: true, unique: false, inject_into_chunk: false },
];

// About a section of a policy per chunk, so each passage is short enough to check at a glance.
// Overlapping chunks start in the middle of a word, which looks broken in a citation.
const CHUNKS = { chars_configuration: { max_chunk_size_chars: 500, chunk_overlap_chars: 0 }, strip_whitespace: true };

type CollectionDocument = { status: string; error_message?: string | null };

const folder = process.argv[2] ?? "handbook";
const managementKey = process.env.XAI_MANAGEMENT_API_KEY;
if (!managementKey) {
  console.error("Set XAI_MANAGEMENT_API_KEY to a management key that can create collections and add documents to them. The README explains how to make one.");
  process.exit(1);
}

// metadata.json lists the documents to upload, with the fields for each one.
const metadata = JSON.parse(await readFile(join(folder, "metadata.json"), "utf8")) as Record<string, Record<string, string>>;
const name = basename(resolve(folder));

const { collection_id } = await manage<{ collection_id: string }>("POST", "/collections", {
  collection_name: name,
  collection_description: `Documents from ${name}, uploaded by the SpaceXAI Cookbook's Docs to Cited Answers example`,
  field_definitions: FIELDS,
  chunk_configuration: CHUNKS,
});
console.log(`Created the collection ${collection_id}`);

const documents: Collection["documents"] = [];
for (const [filename, fields] of Object.entries(metadata)) {
  // Adding a document takes two steps: upload the file with the Files API, then add it to the
  // collection with its fields.
  const file = await client.files.upload({ file: await openAsBlob(join(folder, filename), { type: TYPES[extname(filename)] }), filename });
  await manage("POST", `/collections/${collection_id}/documents/${file.id}`, { fields });
  console.log(`  Added ${filename} with ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  documents.push({ file_id: file.id, filename, fields });
}

console.log("Waiting for the documents to be split into passages and indexed");
const unfinished = await waitUntilProcessed(collection_id, documents);

const collection: Collection = { collection_id, collection_name: name, documents };
await mkdir("output", { recursive: true });
await writeFile(COLLECTION_FILE, JSON.stringify(collection, null, 2));
if (unfinished.length) {
  console.log(`\n${unfinished.map((doc) => doc.filename).join(", ")} still isn't processed, and searches leave it out until it is. If it doesn't finish, run npm run ingest again.`);
}
console.log(`\nSaved the collection's ID to ${COLLECTION_FILE}. Ask a question with npm start, or open the page with npm run web.`);

// A document can be searched once it's processed, which takes a few seconds for a small file. Returns
// the documents that still aren't processed after five minutes.
async function waitUntilProcessed(collectionId: string, waiting: Collection["documents"]): Promise<Collection["documents"]> {
  const deadline = Date.now() + 5 * 60_000;
  while (waiting.length && Date.now() < deadline) {
    await sleep(2000);
    const statuses = await Promise.all(waiting.map((doc) => manage<CollectionDocument>("GET", `/collections/${collectionId}/documents/${doc.file_id}`)));
    waiting = waiting.filter((doc, index) => {
      const { status, error_message } = statuses[index];
      if (status === "DOCUMENT_STATUS_FAILED") throw new Error(`${doc.filename} couldn't be processed: ${error_message}`);
      if (status !== "DOCUMENT_STATUS_PROCESSED") return true;
      console.log(`  ${doc.filename} is ready`);
      return false;
    });
  }
  return waiting;
}

async function manage<T = unknown>(method: string, path: string, body?: object): Promise<T> {
  const response = await fetch(`${MANAGEMENT_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${managementKey}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with status ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}
