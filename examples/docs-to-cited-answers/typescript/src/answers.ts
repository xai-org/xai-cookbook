import { readFile } from "node:fs/promises";
import { SpaceXAI } from "@xai-official/sdk";

// The eval asks several questions at once, so one now and then fails before Grok answers, for example
// when the API is busy. retryBeforeOutput tries those again, which is safe because nothing has been
// streamed yet.
const client = new SpaceXAI({ retryBeforeOutput: true });

// npm run ingest saves the collection's ID and its documents here.
export const COLLECTION_FILE = "output/collection.json";
export const DEFAULT_QUESTION = "Can I return a sale item after 30 days?";
export const DEFAULT_FILTER = 'version="2026"';
export const NOT_FOUND = "I couldn't find that in your documents.";
// How many passages each search returns. Grok reads all of them for every answer.
const PASSAGES = 6;

export type Collection = {
  collection_id: string;
  collection_name: string;
  documents: Array<{ file_id: string; filename: string; fields: Record<string, string> }>;
};
export type Passage = { number: number; file_id: string; filename: string; page: number; score: number; text: string; fields: Record<string, string> };
export type Quote = { passage: number; quote: string };
export type Answer = {
  found: boolean;
  text: string;
  // The quotes Grok gave as evidence, and whether each one really is in its passage.
  quotes: Array<Quote & { checked: boolean }>;
  passages: Passage[];
  tokens: number;
  cost: number;
};

export type AnswerEvents = {
  passages?: (passages: Passage[]) => void;
  reasoning?: (text: string) => void;
  // The quotes so far. The last one can be cut off, or still be missing its passage number.
  quotes?: (quotes: Array<Partial<Quote>>) => void;
  text?: (text: string) => void;
};

type SearchMatch = { file_id: string; chunk_content: string; score: number; page_number?: number; fields: Record<string, string> };
type CitedAnswer = { quotes: Quote[]; found: boolean; answer: string };

const ANSWER_PROMPT = `You answer questions about a company's documents, using only the numbered passages you're given.
- First copy the sentences that answer the question into quotes, word for word, each with the number of its passage. Each quote is one unbroken piece of a single passage, without ellipses. Don't fix or reword anything.
- Then set found to true and write the answer: lead with the direct answer, in two or three plain sentences without markdown, and put the passage number in square brackets after each fact, like [2].
- If passages disagree, say so and cite each of them.
- If the passages don't answer the question, leave quotes empty, set found to false, and leave the answer empty. Don't answer from general knowledge, and don't guess.`;

// The quotes come first, so Grok picks out the evidence before it writes the answer.
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          passage: { type: "integer", description: "The number of the passage the quote comes from" },
          quote: { type: "string", description: "Words copied exactly from that passage" },
        },
        required: ["passage", "quote"],
        additionalProperties: false,
      },
    },
    found: { type: "boolean", description: "Whether the passages answer the question" },
    answer: { type: "string" },
  },
  required: ["quotes", "found", "answer"],
  additionalProperties: false,
};

export async function loadCollection(): Promise<Collection> {
  try {
    return JSON.parse(await readFile(COLLECTION_FILE, "utf8")) as Collection;
  } catch {
    throw new Error(`There's no collection yet. Run npm run ingest first, which saves its ID to ${COLLECTION_FILE}.`);
  }
}

// Searches the documents that match the filter, then streams Grok's answer from the passages it finds,
// reporting each step as it happens so callers can show the work.
export async function answer(question: string, filter: string, collection: Collection, on: AnswerEvents = {}, signal?: AbortSignal): Promise<Answer> {
  const passages = await searchDocuments(question, filter, collection, signal);
  on.passages?.(passages);
  if (!passages.length) return { found: false, text: NOT_FOUND, quotes: [], passages, tokens: 0, cost: 0 };
  return writeAnswer(question, passages, on, signal);
}

// The SDK has no method for the documents search endpoint, so this calls the REST API directly, with
// the same API key the SDK uses. The search tool for Grok, collectionsSearch(), can't take a filter.
export async function searchDocuments(query: string, filter: string, collection: Collection, signal?: AbortSignal): Promise<Passage[]> {
  const response = await fetch("https://api.x.ai/v1/documents/search", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.XAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      source: { collection_ids: [collection.collection_id] },
      filter: filter.trim() || undefined,
      limit: PASSAGES,
    }),
    signal,
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`The search failed: ${error ?? `status ${response.status}`}`);
  }
  const { matches } = (await response.json()) as { matches: SearchMatch[] };
  const documents = new Map(collection.documents.map((document) => [document.file_id, document]));
  return matches.map((match, index) => ({
    number: index + 1,
    file_id: match.file_id,
    filename: documents.get(match.file_id)?.filename ?? match.file_id,
    page: match.page_number ?? 0,
    score: match.score,
    text: match.chunk_content,
    // The search also returns fields of its own, like the file's title, so these come from ingestion.
    fields: documents.get(match.file_id)?.fields ?? match.fields,
  }));
}

async function writeAnswer(question: string, passages: Passage[], on: AnswerEvents, signal?: AbortSignal): Promise<Answer> {
  let grounded: boolean | undefined;
  let written = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // At the default effort, Grok reasons for a while before it writes anything. Copying quotes out of
      // a few passages doesn't need it, and low effort starts quoting within a few seconds.
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: ANSWER_PROMPT },
        { role: "user", content: `${passages.map(formatPassage).join("\n\n")}\n\nQuestion: ${question}` },
      ],
      text: { format: { type: "json_schema", name: "cited_answer", schema: ANSWER_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    // The answer so far, with whatever is still being written closed off. Grok writes the fields in the
    // schema's order, so the quotes and found are finished once the answer starts, and they're checked
    // before any of the answer is shown.
    .on("json", (value) => {
      const partial = value as Partial<CitedAnswer>;
      if (partial.answer === undefined) return on.quotes?.(partial.quotes ?? []);
      grounded ??= isGrounded(partial as CitedAnswer, passages);
      if (!grounded || partial.answer.length <= written) return;
      on.text?.(partial.answer.slice(written));
      written = partial.answer.length;
    })
    .done();
  const cited = response.toJson() as CitedAnswer;
  const found = isGrounded(cited, passages);
  return {
    found,
    text: found ? cited.answer : NOT_FOUND,
    quotes: cited.quotes.map((quote) => ({ ...quote, checked: inPassage(quote, passages) })),
    passages,
    tokens: response.usage.total_tokens,
    cost: response.usage.cost_usd ?? 0,
  };
}

function formatPassage(passage: Passage): string {
  const fields = Object.entries(passage.fields).map(([key, value]) => `${key}: ${value}`);
  return `[${passage.number}] ${passage.filename} (${fields.join(", ")})\n${passage.text}`;
}

// An answer counts only when Grok says it found one and at least one of its quotes really is in the
// passages. Otherwise the app says it couldn't find the answer, instead of passing on a guess.
function isGrounded(cited: CitedAnswer, passages: Passage[]): boolean {
  return cited.found && cited.quotes.some((quote) => inPassage(quote, passages));
}

// Grok is told to copy quotes word for word, so a quote that isn't in its passage means the answer
// strayed from the documents. Differences in spacing, case, and curly quotes don't count.
function inPassage(quote: Quote, passages: Passage[]): boolean {
  const passage = passages.find((candidate) => candidate.number === quote.passage);
  return !!passage && !!quote.quote.trim() && normalize(passage.text).includes(normalize(quote.quote));
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}
