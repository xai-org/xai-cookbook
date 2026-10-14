import { loadBrand, themeFor } from "./brand.ts";
import { findPersonality, listPersonalities } from "./persona.ts";
import { listPresenters, personalityOf } from "./presenter.ts";
import { DEFAULT_PULL_REQUEST, type Stage, type WriteEvents, filmDraft, newCache, reviseDraft, startDraft } from "./short.ts";
import { TAKES_PER_LINE } from "./takes.ts";

// A link to a pull request, or an idea for a video, in quotes, a presenter, and a personality, if not the presenter's own.
const message = process.argv[2] ?? DEFAULT_PULL_REQUEST;
const presenterId = process.argv[3] ?? "maya";
const presenter = (await listPresenters()).find((each) => each.id === presenterId);
if (!presenter) {
  console.error(`Pick a presenter: ${(await listPresenters()).map((each) => each.id).join(", ")}. Presenter Studio makes more.`);
  process.exit(1);
}
const personality = process.argv[4] ?? personalityOf(presenter);
if (!personality.startsWith("@") && !(await findPersonality(personality))) {
  console.error(`Pick a personality, ${(await listPersonalities()).map(({ id }) => id).join(", ")}, or an X handle like @levelsio to copy`);
  process.exit(1);
}
const STAGES: Record<Stage, string> = {
  read: "Reading the pull request",
  persona: personality.startsWith("@") ? `Reading ${personality}'s posts to copy their style` : "",
  write: "Writing the script",
  draw: `Drawing ${presenter.name}, unless an earlier video did`,
  visuals: "Getting what each beat shows: screenshots, clips, and pictures",
  film: `Filming ${TAKES_PER_LINE} takes of each segment at once. Takes render for about a minute.`,
  edit: "Cutting the takes together and adding the cards and captions",
};
const log = (stage: Stage, status: "active" | "done") => {
  if (status === "active" && STAGES[stage]) console.log(STAGES[stage]);
};

const events: WriteEvents = {
  stage: log,
  pullRequest: (pr) => console.log(`"${pr.title}" by ${pr.author}: ${pr.changedFiles} files, +${pr.additions} -${pr.deletions}`),
  persona: (persona) => console.log(`Personality: ${persona.name}. ${persona.summary}`),
  research: (where, query) => console.log(`  Searching ${where === "x" ? "X" : "the web"}: ${query}`),
  note: (note) => console.log(`\nGrok: ${note}\n`),
  questions: (questions) => console.log(questions.map(({ question, choices }) => `  ${question} (${choices.join(", ")})`).join("\n")),
  segment: ({ label, emoji, line, screen, layout }) => {
    const where = screen.kind === "code" ? `${screen.file}, rows ${screen.from}-${screen.to}` : "url" in screen ? screen.url : "prompt" in screen ? `${screen.kind}: ${screen.prompt}` : "";
    console.log(`  ${label} ${emoji} [${layout}${where ? `, ${where}` : ""}]: ${line}`);
  },
};
let written = await startDraft(message, presenter.id, personality, events);
// The terminal can't answer Grok's questions, so Grok goes ahead with its own best guesses.
if (!written.draft.segments.length) {
  console.log("\nGoing ahead without answers.");
  written = await reviseDraft(written.draft, "I can't answer right now, so go with your best judgment.", personality, events);
}
const theme = themeFor(written.draft.theme, await loadBrand());
console.log(`  Theme: ${theme.name}. ${theme.summary}\n`);

const percents: number[] = [];
const short = await filmDraft(written.draft, presenter.id, newCache(), {
  stage: log,
  notice: (message) => console.log(`\n  ${message}`),
  take: (index, update) => {
    percents[index] = update.status === "done" ? 100 : update.percent;
    if (update.status === "done" && update.take.filmed > TAKES_PER_LINE) console.log(`\n  Segment ${index + 1} cut its line off, so it was filmed again, longer.`);
    process.stdout.write(`\r  Takes: ${percents.map((percent, each) => `${each + 1}: ${percent}%`).join("  ")}   `);
  },
  progress: (frame, frames) => process.stdout.write(`\r  ${Math.round((frame / frames) * 100)}% of ${frames} frames   `),
});

const { cost } = short;
const filmed = short.takes.reduce((sum, take) => sum + take.filmed, 0);
console.log(`\n\nSaved ${short.video}, ${short.duration.toFixed(1)} seconds, and its transcript.`);
console.log(`Kept ${short.takes.length} of ${filmed} takes. Their transcripts matched ${short.takes.map((take) => `${Math.round(take.heard * 100)}%`).join(", ")} of their lines.`);
const total = written.cost + cost.presenter + cost.media + cost.takes;
console.log(`Cost: $${total.toFixed(2)} ($${cost.takes.toFixed(2)} for the takes, $${(cost.presenter + cost.media).toFixed(2)} for the pictures and clips, $${written.cost.toFixed(3)} for Grok)`);
