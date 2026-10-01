import { setTimeout as sleep } from "node:timers/promises";
import { xAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";

const client = new xAI();

export const DEFAULT_TOPIC = "SpaceX";
export const ROUNDS = 3;
const INTERVAL_SECONDS = 60;
const WINDOW = 20;

export type Post = { post_id: string; username: string; text: string; created_at: string };
export type Sentiment = { score: number; reasoning: string; key_posts: Array<{ post_id: string; note: string }> };

export type TrackEvents = {
  round?: (round: number, query: string) => void;
  search?: (name: string, input: string) => void;
  found?: (posts: Post[]) => void;
  kept?: (posts: Post[], found: Post[]) => void;
  scoring?: (posts: Post[]) => void;
  reasoning?: (text: string) => void;
  score?: (sentiment: Sentiment) => void;
  wait?: (seconds: number) => void;
};

const POSTS_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "The numeric ID of the post, from its URL" },
          username: { type: "string", description: "The author's X handle, without the @" },
          text: { type: "string", description: "The full text of the post" },
          created_at: { type: "string", description: "When the post was published, in ISO 8601 format" },
        },
        required: ["post_id", "username", "text", "created_at"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};

const FILTER_SCHEMA = {
  type: "object",
  properties: { post_ids: { type: "array", items: { type: "string" } } },
  required: ["post_ids"],
  additionalProperties: false,
};

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", minimum: -1, maximum: 1, description: "From -1 (negative) to 1 (positive), with 0 being neutral" },
    reasoning: { type: "string", description: "A brief explanation of how you arrived at the score" },
    key_posts: {
      type: "array",
      items: {
        type: "object",
        properties: { post_id: { type: "string" }, note: { type: "string" } },
        required: ["post_id", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["score", "reasoning", "key_posts"],
  additionalProperties: false,
};

// Runs the rounds and reports each step as soon as it happens, so callers can show progress while Grok works.
export async function track(topic: string, on: TrackEvents = {}, signal?: AbortSignal): Promise<void> {
  // X's search operators: at least 20 likes, and no reposts or replies. Without a like threshold,
  // the latest posts on most topics are mostly spam.
  const query = `(${topic}) min_faves:20 -is:retweet -is:reply`;
  const seen = new Set<string>();
  const highSignal: Post[] = [];

  for (let round = 1; round <= ROUNDS; round++) {
    on.round?.(round, query);
    const results = await findPosts(query, on, signal);
    const fresh = results.filter((post) => !seen.has(post.post_id));
    fresh.forEach((post) => seen.add(post.post_id));
    on.found?.(fresh);

    const kept = fresh.length ? await filterPosts(fresh, topic, signal) : [];
    highSignal.push(...kept);
    on.kept?.(kept, fresh);

    if (kept.length) {
      const recent = highSignal.slice(-WINDOW);
      on.scoring?.(recent);
      on.score?.(await scoreSentiment(recent, topic, on, signal));
    }

    if (round < ROUNDS) {
      on.wait?.(INTERVAL_SECONDS);
      await sleep(INTERVAL_SECONDS * 1000, undefined, { signal });
    }
  }
}

async function findPosts(query: string, on: TrackEvents, signal?: AbortSignal): Promise<Post[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const cited = new Set<string>();
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: `Search X for the latest posts matching this query: ${query}
Return up to 10 posts exactly as they appear in the search results. Don't make up or paraphrase posts.`,
      tools: [xSearch({ from_date: yesterday })],
      text: { format: { type: "json_schema", name: "posts", schema: POSTS_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("server_tool_call", (call) => {
      if (call.type === "custom_tool_call") on.search?.(call.name, call.input ?? "");
    })
    .on("citation", (citation) => {
      const id = citation.url.match(/\/status\/(\d+)/)?.[1];
      if (id) cited.add(id);
    })
    .done();
  const { posts } = response.toJson() as { posts: Post[] };
  // Grok cites every post it got from X Search, so keeping only cited posts rules out made-up ones.
  return posts.filter((post) => cited.has(post.post_id));
}

async function filterPosts(posts: Post[], topic: string, signal?: AbortSignal): Promise<Post[]> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: `You pick out X posts that show how people feel about ${topic}: opinions, reactions, or news with a clear take on it. Leave out ads, spam, vague hype, and posts that are mainly about something else. Return the IDs of the posts worth keeping, or an empty list.`,
        },
        { role: "user", content: JSON.stringify(posts) },
      ],
      text: { format: { type: "json_schema", name: "filtered_posts", schema: FILTER_SCHEMA } },
    },
    { signal },
  );
  const { post_ids } = response.toJson() as { post_ids: string[] };
  return posts.filter((post) => post_ids.includes(post.post_id));
}

async function scoreSentiment(posts: Post[], topic: string, on: TrackEvents, signal?: AbortSignal): Promise<Sentiment> {
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "system",
          content: `Score the overall sentiment toward ${topic} in these X posts from -1 (very negative) to 1 (very positive), with 0 being neutral. Weigh each post by how clear its sentiment is and how prominent its author is, and base the score only on these posts. Explain the score briefly and list the posts that influenced it most.`,
        },
        { role: "user", content: JSON.stringify(posts) },
      ],
      text: { format: { type: "json_schema", name: "sentiment", schema: SENTIMENT_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream.on("reasoning", (text) => on.reasoning?.(text)).done();
  return response.toJson() as Sentiment;
}
