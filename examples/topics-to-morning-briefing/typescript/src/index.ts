import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, styleText } from "node:util";
import { type Briefing, DEFAULT_MAX_COST, type TopicReport, makeBriefing, readTopics } from "./briefing.ts";
import { isoDate } from "./memory.ts";

const LABELS = { new: "New", update: "Update", old: "Already covered" };
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "max-cost": { type: "string" }, every: { type: "string" } },
});
const topics = positionals.length ? positionals : await readTopics();
const maxCost = Number(values["max-cost"] ?? DEFAULT_MAX_COST);
const every = values.every?.match(/^(\d+)([mhd])$/);
if (!topics.length || !(maxCost > 0) || (values.every && !every)) {
  console.error("Usage: npm start -- [topics...] [--max-cost 0.50] [--every 30m|12h|1d]");
  process.exit(1);
}

// With --every, it briefs again that long after each briefing started, until you stop it with Ctrl+C.
for (;;) {
  const started = Date.now();
  await brief();
  if (!every) break;
  const next = started + Number(every[1]) * UNITS[every[2] as keyof typeof UNITS];
  console.log(styleText("dim", `\nNext briefing at ${new Date(next).toLocaleString()}. Press Ctrl+C to stop.\n`));
  await sleep(Math.max(0, next - Date.now()));
}

async function brief(): Promise<void> {
  console.log(styleText("bold", `Briefing on ${topics.join(", ")}`));
  const reasons: string[] = [];
  const transcript: string[] = [];
  const started = new Set<number>();
  const briefing = await makeBriefing(topics, maxCost, {
    start: (plan) => {
      console.log(styleText("dim", `Searching 𝕏 and the web from ${plan.from} through ${lastDay(plan.to)} (UTC)`));
      if (plan.briefings) console.log(styleText("dim", `Remembering ${plural(plan.remembered, "story", "stories")} on these topics from ${plural(plan.briefings, "earlier briefing")}`));
    },
    topic: (index) => {
      started.add(index);
      console.log(`\n${styleText("bold", topics[index])}`);
    },
    search: (_, search) => console.log(styleText("dim", `  ${search.tool === "x" ? "𝕏  " : "web"}  ${search.text}`)),
    report: (_, report) => printReport(report),
    skipped: (index, reason) => {
      reasons[index] = reason;
      if (!started.has(index)) console.log(`\n${styleText("bold", topics[index])}`);
      console.log(`  ${reason}`);
    },
    clip: (index, _, text) => (transcript[index] = text),
  });
  const notes = `${briefing.dir}/briefing.md`;
  await writeFile(notes, showNotes(briefing, reasons, transcript));
  console.log(`\nSaved ${briefing.file} (${minutes(briefing.seconds)}) and ${notes}`);
  console.log(`Cost: $${briefing.cost.toFixed(3)} of the $${maxCost.toFixed(2)} cap`);
}

function printReport(report: TopicReport): void {
  for (const story of report.stories) {
    console.log(`  ${LABELS[story.status]}: ${story.headline}`);
    for (const source of [...story.posts, ...story.articles]) console.log(styleText("dim", `    ${source.url}`));
  }
  if (!report.stories.some((story) => story.status !== "old")) console.log("  Nothing new");
  console.log(styleText("dim", `  $${report.cost.toFixed(3)} for ${plural(report.posts, "post")} in ${plural(report.searches, "search", "searches")}`));
}

function showNotes(briefing: Briefing, reasons: string[], transcript: string[]): string {
  const sections = topics.map((topic, index) => {
    const report = briefing.reports[index];
    if (!report) return `## ${topic}\n\n${reasons[index]}.\n`;
    const stories = report.stories.map((story) => {
      const sources = [
        ...story.posts.map((post) => `- [@${post.author}](${post.url}): ${post.text.replace(/\s+/g, " ")}`),
        ...story.articles.map((article) => `- [${article.site}: ${article.title}](${article.url})`),
      ];
      return `### ${LABELS[story.status]}: ${story.headline}\n\n${story.summary}\n\n${sources.join("\n")}\n`;
    });
    return `## ${topic}\n\n${stories.join("\n") || "Nothing new.\n"}`;
  });
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `# Briefing for ${date}

News from ${briefing.from} through ${lastDay(briefing.to)} (UTC), from 𝕏 and the web. It cost $${briefing.cost.toFixed(3)}.

${sections.join("\n")}
## Transcript

${transcript.filter(Boolean).join("\n\n")}
`;
}

// to_date is exclusive, so the last day searched is the one before it.
function lastDay(to: string): string {
  return isoDate(Date.parse(to) - UNITS.d);
}

function minutes(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function plural(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}
