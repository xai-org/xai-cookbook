import { mkdir, writeFile } from "node:fs/promises";
import { styleText } from "node:util";
import { type FactCheck, type Search, type Verdict, SAMPLE_POST, factCheck } from "./factcheck.ts";

const VERDICTS: Record<Verdict, string> = {
  supported: "Supported",
  missing_context: "Missing context",
  not_enough_evidence: "Not enough evidence",
};

const args = process.argv.slice(2);
const deep = args.includes("--deep");
const link = args.find((arg) => !arg.startsWith("--")) ?? SAMPLE_POST;

console.log(styleText("bold", `Reading ${link}`));
const result = await factCheck(link, deep, {
  tool: (search) => console.log(styleText("dim", `  ${label(search)}`)),
  read: (post, claims) => {
    console.log(`\n@${post.username}: ${post.text.replace(/\s+/g, " ")}`);
    for (const item of post.media) console.log(styleText("dim", `  ${item.type}: ${item.description}`));
    if (!claims.length) return console.log("\nThe post makes no claims that can be checked.");
    console.log(styleText("bold", `\nChecking ${plural(claims.length, "claim")} on the web and X, all at once${deep ? ", with four agents each" : ""}`));
    claims.forEach((claim, index) => console.log(`  ${index + 1}. ${claim.text}${claim.from === "text" ? "" : ` (from the ${claim.from})`}`));
  },
  search: (index, search) => console.log(styleText("dim", `  ${index + 1}: ${label(search)}`)),
  checked: (index, check) => {
    console.log(`\n${index + 1}. ${styleText("bold", VERDICTS[check.verdict])}: ${check.explanation}`);
    for (const source of check.sources) console.log(styleText("dim", `   ${source.url}`));
    if (check.dropped) console.log(styleText("dim", `   Dropped ${plural(check.dropped, "source")} that didn't come back as a citation`));
  },
  writing: (sources) => console.log(styleText("bold", `\nWriting the note from ${plural(sources.length, "source")}`)),
});

if (result.note) {
  console.log(result.note.sentences.map((sentence) => `${sentence.text} ${sentence.sources.map((n) => `[${n}]`).join("")}`).join(" "));
  result.note.sources.forEach((source, index) => console.log(styleText("dim", `  [${index + 1}] ${source.title}: ${source.url}`)));
} else if (result.checks.length) {
  console.log("\nNo claim had a source that held up, so there's no note.");
}

const { cost, xPosts, webSearches, tokens } = result.spend;
console.log(`\nChecked in ${result.seconds} seconds. The API reported $${cost.toFixed(2)} for ${plural(xPosts, "post")} from X, ${plural(webSearches, "web search", "web searches")}, and ${tokens.toLocaleString("en")} tokens.`);
const name = `${result.post.username}-${result.post.id}`;
await mkdir("output", { recursive: true });
await writeFile(`output/${name}.md`, markdown(result));
await writeFile(`output/${name}.json`, JSON.stringify(result, null, 2));
console.log(`Saved output/${name}.md and output/${name}.json`);

function label(search: Search): string {
  if (search.tool === "web_search") return `Searched the web for ${search.detail}, ${plural(search.found.length, "page")} found`;
  if (search.tool === "view_x_video") return `Watched ${search.detail}`;
  if (search.tool === "open_page" || search.tool === "find_in_page") return `Opened ${search.detail}`;
  if (search.tool === "x_thread_fetch") return `Fetched post ${search.detail} and its thread on X`;
  if (search.tool === "x_user_search") return `Looked up ${search.detail} on X`;
  if (search.tool.startsWith("x_")) return `Searched X for ${search.detail}`;
  return `${search.tool} ${search.detail}`.trim();
}

function markdown({ post, checks, note }: FactCheck): string {
  const quote = post.text.split("\n").map((line) => `> ${line}`).join("\n");
  const sentences = note?.sentences.map((sentence) => `${sentence.text} ${sentence.sources.map((n) => `[[${n}]](${note.sources[n - 1].url})`).join("")}`);
  const sources = note?.sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`);
  const claims = checks.map((check, index) => {
    const cited = check.sources.map((source) => `   - [${source.title}](${source.url}): ${source.finding}`);
    return [`${index + 1}. **${VERDICTS[check.verdict]}.** ${check.claim.text}`, `   ${check.explanation}`, ...cited].join("\n");
  });
  return `# Fact-check of a post by @${post.username}

${quote}

[${post.url}](${post.url}), published ${post.posted_at.slice(0, 10)}

## Note

${sentences?.join(" ") ?? "No claim had a source that held up, so there's no note."}

## Claims

${claims.join("\n\n") || "The post makes no claims that can be checked."}
${sources ? `\n## Sources\n\n${sources.join("\n")}\n` : ""}`;
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
