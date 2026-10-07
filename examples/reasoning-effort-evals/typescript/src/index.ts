import { readFile } from "node:fs/promises";
import { styleText } from "node:util";
import { BATCH_MODEL, EFFORTS, MIN_SAVING, MODEL, type Summary, TOLERANCE, runScorecard, saveScorecard } from "./scorecard.ts";
import { parseTask } from "./task.ts";

const args = process.argv.slice(2);
const batch = args.includes("--batch");
const path = args.find((arg) => !arg.startsWith("--")) ?? "sample-task.json";
const task = parseTask(JSON.parse(await readFile(path, "utf8")));
const total = task.cases.length * EFFORTS.length;

// Ctrl+C stops the run, and in batch mode cancels the batch, so nothing more is billed.
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());

console.log(styleText("bold", `${task.name}: ${plural(task.cases.length, "case")} at ${EFFORTS.join(", ")} reasoning effort with ${batch ? `${BATCH_MODEL} through the Batch API` : MODEL}`));
let graded = 0;
let retries = 0;
const progress = () => process.stdout.write(styleText("dim", `\r  ${graded} of ${total} answers graded${retries ? `, ${plural(retries, "rate-limited request")} retried` : ""}`));

let scorecard;
try {
  scorecard = await runScorecard(
    task,
    { batch },
    {
      graded: () => {
        graded++;
        progress();
      },
      rateLimited: () => {
        retries++;
        progress();
      },
      batch: (id, done) => {
        if (!done) console.log(styleText("dim", `  Sent ${total} requests in batch ${id}. Waiting for results.`));
      },
      finished: (summary) => console.log(`\r  ${summary.effort.padEnd(7)}${describe(summary)}`.padEnd(80)),
      comparing: (pick, best) => console.log(styleText("dim", `\n  Comparing ${pick}'s answers with ${best}'s, in both orders`)),
    },
    abort.signal,
  );
} catch (error) {
  if (!abort.signal.aborted) throw error;
  console.log("\nStopped.");
  process.exit(130);
}

const { summaries, best, pick, headToHead, graded: answers } = scorecard;
console.log(`\n${styleText("bold", "effort   correct   per 1,000 answers   median latency   reasoning tokens")}`);
for (const summary of summaries) {
  const columns = [
    summary.effort.padEnd(9),
    percent(summary.accuracy).padEnd(10),
    dollars(summary.costPer1000).padEnd(20),
    seconds(summary.latency).padEnd(17),
    String(summary.reasoningTokens),
  ];
  console.log(columns.join(""));
}

const picked = summaries.find((summary) => summary.effort === pick)!;
const top = summaries.find((summary) => summary.effort === best)!;
console.log(
  `\n${styleText("bold", pick === best ? `${pick} scores best, and nothing within ${TOLERANCE} points of it costs ${Math.round(MIN_SAVING * 100)}% less.` : `${pick} is the cheapest effort within ${TOLERANCE} points of the best.`)}`,
);
console.log(
  pick === best
    ? `${percent(picked.accuracy)} correct at ${dollars(picked.costPer1000)} per 1,000 answers.`
    : `${percent(picked.accuracy)} correct at ${dollars(picked.costPer1000)} per 1,000 answers, ${Math.round((1 - picked.cost / top.cost) * 100)}% less than ${best}, which scores ${percent(top.accuracy)} at ${dollars(top.costPer1000)}.`,
);
if (headToHead) {
  console.log(`Head to head, ${pick}'s answers beat ${best}'s in ${headToHead.wins} cases, tied in ${headToHead.ties}, and lost ${headToHead.losses}.`);
}

const wrong = answers.filter((answer) => answer.effort === pick && !answer.passed);
console.log(styleText("bold", `\nWrong at ${pick}: ${wrong.length} of ${picked.cases}`));
for (const answer of wrong) {
  for (const check of answer.checks.filter((check) => !check.pass)) console.log(`  ${answer.caseId} ${check.name}: ${check.note}`);
}

const saved = await saveScorecard(scorecard);
const cost = scorecard.cost.answers + scorecard.cost.grading;
console.log(`\nSaved ${saved}`);
console.log(`This scorecard cost ${dollars(cost)}: ${dollars(scorecard.cost.answers)} for the answers and ${dollars(scorecard.cost.grading)} for grading. It took ${duration(scorecard.seconds)}.`);

function describe(summary: Summary): string {
  return `${percent(summary.accuracy)} correct, ${dollars(summary.costPer1000)} per 1,000 answers${summary.latency === null ? "" : `, ${seconds(summary.latency)} median`}`;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

function duration(total: number): string {
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
