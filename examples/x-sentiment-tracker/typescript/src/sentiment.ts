import { SpaceXAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";

// Ten searches start at once, so one now and then fails before Grok answers, for example when the API
// is busy. retryBeforeOutput tries those again, which is safe because nothing has been streamed yet.
const client = new SpaceXAI({ retryBeforeOutput: true });

export const DEFAULT_TOPIC = "SpaceX";
// X Search returns at most 10 posts per search, so the app runs one search for each of the last DAYS days.
const DAYS = 10;
const DAY_MS = 86_400_000;

export type Post = { post_id: string; username: string; text: string; created_at: string };
export type Sentiment = {
  // Each post's own score, which lets a caller show how the sentiment moved from day to day.
  post_scores: Array<{ post_id: string; score: number }>;
  score: number;
  reasoning: string;
  key_posts: Array<{ post_id: string; note: string }>;
};

export type AnalyzeEvents = {
  searching?: (query: string, days: string[]) => void;
  search?: (day: string, input: string) => void;
  // Gets the error instead of posts when that day's search failed.
  searched?: (day: string, posts: Post[] | undefined, error?: Error) => void;
  found?: (posts: Post[]) => void;
  kept?: (posts: Post[], found: Post[]) => void;
  scoring?: (posts: Post[]) => void;
  reasoning?: (text: string) => void;
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

// The posts' own scores come first, so Grok judges each post before it settles on the overall score.
const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    post_scores: {
      type: "array",
      items: {
        type: "object",
        properties: { post_id: { type: "string" }, score: { type: "number", minimum: -1, maximum: 1 } },
        required: ["post_id", "score"],
        additionalProperties: false,
      },
    },
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
  required: ["post_scores", "score", "reasoning", "key_posts"],
  additionalProperties: false,
};

// Searches X, filters the posts, and scores the ones worth keeping, reporting each step as soon as it
// happens so callers can show progress while Grok works. Returns nothing if no post was worth scoring.
export async function analyze(topic: string, on: AnalyzeEvents = {}, signal?: AbortSignal): Promise<Sentiment | undefined> {
  // X's search operators: at least 20 likes, and no reposts or replies. Without a like threshold,
  // the latest posts on most topics are mostly spam.
  const query = `(${topic}) min_faves:20 -is:retweet -is:reply`;
  const days = Array.from({ length: DAYS }, (_, i) => new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10));
  on.searching?.(query, days);
  const results = await Promise.all(
    days.map(async (day) => {
      // One failed search shouldn't sink the other nine, so a day that still fails after the client's
      // retries is reported with the error and skipped.
      try {
        const posts = await findPosts(query, day, on, signal);
        on.searched?.(day, posts);
        return posts;
      } catch (error) {
        if (signal?.aborted) throw error;
        on.searched?.(day, undefined, error instanceof Error ? error : new Error(String(error)));
        return [];
      }
    }),
  );
  const found = [...new Map(results.flat().map((post) => [post.post_id, post])).values()];
  on.found?.(found);
  const kept = found.length ? await filterPosts(found, topic, signal) : [];
  on.kept?.(kept, found);
  if (!kept.length) return undefined;
  on.scoring?.(kept);
  return scoreSentiment(kept, topic, on, signal);
}

async function findPosts(query: string, day: string, on: AnalyzeEvents, signal?: AbortSignal): Promise<Post[]> {
  // The search window stops at the start of to_date, so a single day runs from that day to the next.
  const next = new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);
  const cited = new Set<string>();
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: `Search X for the most popular posts matching this query: ${query}
Return up to 10 posts exactly as they appear in the search results. Don't make up or paraphrase posts.`,
      tools: [xSearch({ from_date: day, to_date: next })],
      text: { format: { type: "json_schema", name: "posts", schema: POSTS_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("server_tool_call", (call) => {
      if (call.type === "custom_tool_call") on.search?.(day, call.input ?? "");
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

async function scoreSentiment(posts: Post[], topic: string, on: AnalyzeEvents, signal?: AbortSignal): Promise<Sentiment> {
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // At the default effort, Grok reasons through every post before it answers, which takes minutes
      // once each post gets its own score. Low effort takes seconds and puts nearly every post on the
      // same side.
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: `Score the sentiment toward ${topic} in these X posts from -1 (very negative) to 1 (very positive), with 0 being neutral. First score every post on its own, from -1 to 1 like the overall score. Then give the overall score, weighing each post by how clear its sentiment is and how prominent its author is, and base it only on these posts. Explain the overall score briefly and list the posts that influenced it most.`,
        },
        { role: "user", content: JSON.stringify(posts) },
      ],
      text: { format: { type: "json_schema", name: "sentiment", schema: SENTIMENT_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream.on("reasoning", (text) => on.reasoning?.(text)).done();
  const sentiment = response.toJson() as Sentiment;
  // The schema's minimum and maximum aren't enforced, and Grok sometimes scores the most one-sided
  // posts past -1 or 1, so the scores are clamped.
  const clamp = (score: number) => Math.min(1, Math.max(-1, score));
  return {
    ...sentiment,
    score: clamp(sentiment.score),
    post_scores: sentiment.post_scores.map((post) => ({ ...post, score: clamp(post.score) })),
  };
}
