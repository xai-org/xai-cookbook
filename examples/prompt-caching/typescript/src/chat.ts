import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type InputItem, type LanguageModel, SpaceXAI } from "@xai-official/sdk";

// When the latest attempt of each request started, by the ID the SDK sends with every attempt of a call.
const attempts = new Map<string, number>();

const client = new SpaceXAI({
  // The comparison keeps three chats going at once for a few minutes, which can run into a rate limit on
  // tokens per minute. The SDK waits longer before each retry, up to 30 seconds, so seven retries can wait
  // out a limit like that. It also retries requests that fail before Grok answers, so a chat doesn't stop
  // halfway through.
  maxRetries: 7,
  retryBeforeOutput: true,
  // A retry waits before it's sent, so turns are timed from the attempt that got through.
  onRequest: (request) => {
    attempts.set(request.headers.get("x-client-request-id") ?? "", performance.now());
  },
});

export const MODEL = "grok-4.7";
// A chat that compacts does it once the turns since its last compaction pass this many tokens. Those turns
// are all a compaction can shrink, since the system prompt stays as it is. It's low, so the 30 scripted
// turns compact a couple of times.
export const COMPACT_AFTER = 1_500;

const HANDBOOK = readFileSync(new URL("../handbook.md", import.meta.url), "utf8");
const PROMPT = `You're the crew assistant at Ares Station, a research station on Mars. Answer questions from the crew using the handbook below. Answer in plain sentences and in under 80 words, unless you're asked for a list. If the handbook doesn't cover something, say so and suggest who to ask.`;

export type ChatOptions = {
  // Where the chat tells Grok the current time: at the top of the latest message, or at the top of the
  // system prompt, where many apps put it.
  time: "message" | "top";
  // Compact the chat whenever its turns since the last compaction pass COMPACT_AFTER tokens.
  compact: boolean;
};

export type Chat = ChatOptions & {
  id: string;
  // The latest compaction item, which stands in for every turn before it, and the turns since.
  compacted: InputItem[];
  turns: InputItem[];
  // The input tokens of the first turn since the chat started or was compacted, and the tokens the next
  // turn starts with: the last turn's input and output. Both are zero until a turn measures the chat.
  base: number;
  context: number;
};

// In US dollars.
export type Cost = { cached: number; input: number; output: number; total: number };

export type Compaction = {
  messages: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost: Cost;
  total_ms: number;
};

export type Turn = {
  question: string;
  answer: string;
  input_tokens: number;
  cached_tokens: number;
  // Includes the reasoning tokens.
  output_tokens: number;
  reasoning_tokens: number;
  cost: Cost;
  first_token_ms: number;
  total_ms: number;
  // Set when the chat was compacted after this turn.
  compaction?: Compaction;
};

export type TurnEvents = {
  text?: (text: string) => void;
};

export function newChat(options: ChatOptions): Chat {
  return { ...options, id: randomUUID(), compacted: [], turns: [], base: 0, context: 0 };
}

export function shouldCompact(chat: Chat): boolean {
  return chat.compact && chat.context - chat.base >= COMPACT_AFTER;
}

// Sends one message, then adds it and Grok's answer to the chat, reporting the answer as it streams in.
export async function sendMessage(chat: Chat, question: string, on: TurnEvents = {}, signal?: AbortSignal): Promise<Turn> {
  // The cache reuses a prompt up to the first token that differs from the last one. The time changes on
  // every turn, so at the top of the system prompt it makes the whole prompt new. At the top of the
  // latest message it's part of what's new anyway, and everything before it is what the last turn sent.
  const time = `Current time: ${new Date().toISOString()}`;
  const top = chat.time === "top";
  const system: InputItem = { role: "system", content: top ? `${time}\n\n${PROMPT}\n\n${HANDBOOK}` : `${PROMPT}\n\n${HANDBOOK}` };
  const message: InputItem = { role: "user", content: top ? question : `${time}\n\n${question}` };
  const started = performance.now();
  const stream = await client.responses.create(
    {
      model: MODEL,
      // A compaction item has to come first, because the API drops anything before it, instructions
      // included. So the system prompt goes right after it, which keeps the handbook word for word however
      // often the chat is compacted.
      input: [...chat.compacted, system, ...chat.turns, message],
      // Sends every turn of a chat to the server that has the chat cached.
      prompt_cache_key: `chat:${chat.id}`,
      // A question about the handbook needs little thought, and low effort answers it in a few seconds,
      // which adds up over the 30 scripted turns.
      reasoning: { effort: "low" },
      stream: true,
    },
    { signal },
  );
  const id = stream.http.clientRequestId;
  const elapsed = () => performance.now() - (attempts.get(id) ?? started);
  let firstToken = 0;
  const response = await stream
    .on("reasoning", () => {
      firstToken ||= elapsed();
    })
    .on("text", (text) => {
      firstToken ||= elapsed();
      on.text?.(text);
    })
    .done();
  const total = elapsed();
  attempts.delete(id);
  // toInput() carries Grok's reasoning items too, with their encrypted content. Without them, the next
  // turn's cache hit stops where this answer begins, and Grok forgets why it answered the way it did.
  chat.turns.push(message, ...response.toInput());
  const { usage } = response;
  chat.base ||= usage.input_tokens;
  chat.context = usage.input_tokens + usage.output_tokens;
  return {
    question,
    answer: response.toText(),
    input_tokens: usage.input_tokens,
    cached_tokens: usage.input_tokens_details.cached_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.output_tokens_details.reasoning_tokens,
    cost: await price(usage.input_tokens, usage.input_tokens_details.cached_tokens, usage.output_tokens),
    first_token_ms: Math.round(firstToken || total),
    total_ms: Math.round(total),
  };
}

// Replaces the chat's turns, and its last compaction if it has one, with one encrypted item that stands
// in for them. The next prompt starts with that new item, so it misses the cache.
export async function compactChat(chat: Chat, signal?: AbortSignal): Promise<Compaction> {
  const started = performance.now();
  const compacted = await client.responses.compact({ model: MODEL, input: [...chat.compacted, ...chat.turns] }, { signal });
  chat.compacted = compacted.output;
  chat.turns = [];
  chat.base = 0;
  chat.context = 0;
  const usage = compacted.usage;
  const input = usage?.input_tokens ?? 0;
  const cached = usage?.input_tokens_details.cached_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const reasoning = usage?.output_tokens_details.reasoning_tokens ?? 0;
  return {
    messages: usage?.dropped_message_count ?? 0,
    input_tokens: input,
    cached_tokens: cached,
    output_tokens: output,
    reasoning_tokens: reasoning,
    // Unlike a response's output tokens, a compaction's don't include its reasoning tokens.
    cost: await price(input, cached, output + reasoning),
    total_ms: Math.round(performance.now() - started),
  };
}

let rates: Promise<LanguageModel> | undefined;

// A response reports its cost only as a total, and a compaction reports none, so each part is priced
// from its tokens with the model's rates, which are in US cents per 100 million tokens. Chats here stay
// far below the long-context threshold of 200,000 tokens, where the rates double.
async function price(input: number, cached: number, output: number): Promise<Cost> {
  rates ??= client.models.language.get(MODEL).catch((error) => {
    rates = undefined;
    throw error;
  });
  const model = await rates;
  const cost = {
    cached: (cached * model.cached_prompt_text_token_price) / 1e10,
    input: ((input - cached) * model.prompt_text_token_price) / 1e10,
    output: (output * model.completion_text_token_price) / 1e10,
  };
  return { ...cost, total: cost.cached + cost.input + cost.output };
}
