import { styleText } from "node:util";
import { DEFAULT_TOPIC, analyze } from "./sentiment.ts";

const topic = process.argv.slice(2).join(" ") || DEFAULT_TOPIC;

const sentiment = await analyze(topic, {
  searching: (query, days) => console.log(styleText("bold", `Searching X for ${query}, one search per day for the last ${days.length} days`)),
  searched: (day, posts) => console.log(styleText("dim", `  ${day}: ${posts ? plural(posts.length, "post") : "the search failed"}`)),
  kept: (kept, found) => {
    console.log(`${plural(found.length, "post")}, ${kept.length} worth scoring`);
    for (const post of kept.slice(0, 10)) console.log(styleText("dim", `  @${post.username}: ${post.text.replace(/\s+/g, " ").slice(0, 110)}`));
    if (kept.length > 10) console.log(styleText("dim", `  and ${kept.length - 10} more`));
  },
  scoring: () => console.log(styleText("dim", "\nGrok is thinking:")),
  reasoning: (text) => process.stdout.write(styleText("dim", text)),
});

if (sentiment) {
  console.log(`\n\n${styleText("bold", `${topic} sentiment: ${formatScore(sentiment.score)}`)} ${bar(sentiment.score)}`);
  console.log(sentiment.reasoning);
  for (const post of sentiment.key_posts) console.log(styleText("dim", `  https://x.com/i/status/${post.post_id} ${post.note}`));
} else {
  console.log(`\nNo posts about ${topic} were worth scoring.`);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatScore(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function bar(score: number): string {
  const filled = Math.round(((score + 1) / 2) * 20);
  return `[${"#".repeat(filled)}${"-".repeat(20 - filled)}]`;
}
