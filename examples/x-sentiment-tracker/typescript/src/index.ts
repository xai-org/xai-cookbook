import { setTimeout as sleep } from "node:timers/promises";
import { styleText } from "node:util";
import { xAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";

const client = new xAI();

const ROUNDS = 3;
const INTERVAL_SECONDS = 60;
const WINDOW = 20;

type Post = { post_id: string; username: string; text: string; created_at: string };
type Sentiment = { score: number; reasoning: string; key_posts: Array<{ post_id: string; note: string }> };

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
    score: { type: "number", minimum: -1, maximum: 1, description: "From -1 (bearish) to 1 (bullish), with 0 being neutral" },
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

const topic = process.argv.slice(2).join(" ") || "Bitcoin";
// X's search operators: at least 20 likes, and no reposts or replies. Without a like threshold,
// the latest posts on most topics are mostly spam.
const query = `(${topic}) min_faves:20 -is:retweet -is:reply`;

const seen = new Set<string>();
const signal: Post[] = [];

for (let round = 1; round <= ROUNDS; round++) {
  console.log(styleText("bold", `\nRound ${round} of ${ROUNDS}: searching X for ${query}`));
  const found = await findPosts(query);
  const fresh = found.filter((post) => !seen.has(post.post_id));
  fresh.forEach((post) => seen.add(post.post_id));

  const kept = fresh.length ? await filterPosts(fresh, topic) : [];
  signal.push(...kept);
  console.log(`${fresh.length} new ${fresh.length === 1 ? "post" : "posts"}, ${kept.length} worth scoring`);
  for (const post of kept) console.log(styleText("dim", `  @${post.username}: ${post.text.replace(/\s+/g, " ").slice(0, 110)}`));

  if (kept.length) {
    const sentiment = await scoreSentiment(signal.slice(-WINDOW), topic);
    console.log(`\n${styleText("bold", `${topic} sentiment: ${formatScore(sentiment.score)}`)} ${bar(sentiment.score)}`);
    console.log(sentiment.reasoning);
    for (const post of sentiment.key_posts) console.log(styleText("dim", `  https://x.com/i/status/${post.post_id} ${post.note}`));
  }

  if (round < ROUNDS) {
    console.log(styleText("dim", `\nNext search in ${INTERVAL_SECONDS} seconds`));
    await sleep(INTERVAL_SECONDS * 1000);
  }
}

async function findPosts(query: string): Promise<Post[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const cited = new Set<string>();
  const stream = await client.responses.create({
    model: "grok-4.7",
    reasoning: { effort: "low" },
    input: `Search X for the latest posts matching this query: ${query}
Return up to 10 posts exactly as they appear in the search results. Don't make up or paraphrase posts.`,
    tools: [xSearch({ from_date: yesterday })],
    text: { format: { type: "json_schema", name: "posts", schema: POSTS_SCHEMA } },
    stream: true,
  });
  const response = await stream
    .on("server_tool_call", (call) => {
      if (call.type === "custom_tool_call") console.log(styleText("dim", `  ${call.name} ${call.input}`));
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

async function filterPosts(posts: Post[], topic: string): Promise<Post[]> {
  const response = await client.responses.create({
    model: "grok-4.7",
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content: `You pick out X posts that say something meaningful about market sentiment toward ${topic}: opinions, news, or observations about how it's doing. Leave out ads, spam, vague hype, and posts that are mainly about something else. Return the IDs of the posts worth keeping, or an empty list.`,
      },
      { role: "user", content: JSON.stringify(posts) },
    ],
    text: { format: { type: "json_schema", name: "filtered_posts", schema: FILTER_SCHEMA } },
  });
  const { post_ids } = response.toJson() as { post_ids: string[] };
  return posts.filter((post) => post_ids.includes(post.post_id));
}

async function scoreSentiment(posts: Post[], topic: string): Promise<Sentiment> {
  console.log(styleText("dim", "\nGrok is thinking:"));
  const stream = await client.responses.create({
    model: "grok-4.7",
    input: [
      {
        role: "system",
        content: `You're a market analyst. Score the overall sentiment toward ${topic} in these X posts from -1 (bearish) to 1 (bullish), with 0 being neutral. Weigh each post by how clear its sentiment is and how prominent its author is, and base the score only on these posts. Explain the score briefly and list the posts that influenced it most.`,
      },
      { role: "user", content: JSON.stringify(posts) },
    ],
    text: { format: { type: "json_schema", name: "sentiment", schema: SENTIMENT_SCHEMA } },
    stream: true,
  });
  const response = await stream.on("reasoning", (text) => process.stdout.write(styleText("dim", text))).done();
  process.stdout.write("\n");
  return response.toJson() as Sentiment;
}

function formatScore(score: number): string {
  return `${score > 0 ? "+" : ""}${score.toFixed(1)}`;
}

function bar(score: number): string {
  const filled = Math.round(((score + 1) / 2) * 20);
  return `[${"#".repeat(filled)}${"-".repeat(20 - filled)}]`;
}
