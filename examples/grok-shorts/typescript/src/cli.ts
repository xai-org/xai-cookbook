import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type GitHubPullRequest, pullRequestFrom } from "./github.ts";

// Makes a video one step at a time from the terminal, for scripts and agents. Each command prints its result as JSON on
// stdout, and what it's doing along the way on stderr. A step that fails prints {"error": "..."} and exits with 1.
const USAGE = `Make a video one step at a time. Each command prints its result as JSON.

  npm run -s shorts -- presenters
  npm run -s shorts -- draft "<link to a pull request, or an idea>" [--presenter <id>] [--personality <id or @handle>]
                             [--file <notes.md>] [--pr <pull-request.json>] [--go-ahead]
  npm run -s shorts -- revise <project> "<answers, or what to change>" [--personality <id or @handle>] [--file <notes.md>]
  npm run -s shorts -- show <project>
  npm run -s shorts -- estimate <project> [--presenter <id>]
  npm run -s shorts -- preview <project> [--presenter <id>]
  npm run -s shorts -- film <project> [--presenter <id>] [--max-usd <dollars>]
  npm run -s shorts -- caption <project> [--platform shorts|tiktok|reels]

<project> is the name draft returns: the video's folder in output/.`;
const STOPPED = "Stopped. Takes that were done are kept for next time, and ones that had started are still billed, since the API can't cancel a video.";

const stopping = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stopping.abort());

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      presenter: { type: "string" },
      personality: { type: "string" },
      file: { type: "string" },
      pr: { type: "string" },
      "go-ahead": { type: "boolean" },
      "max-usd": { type: "string" },
      platform: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...words] = positionals;
  if (!command || values.help) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    // Files are read from where the command runs, and the app works from its own folder, where output/ is.
    const notes = values.file ? await readFile(resolve(values.file), "utf8") : "";
    const pullRequest = values.pr ? pullRequestFrom(parseJson(await readFile(resolve(values.pr), "utf8"), values.pr)) : undefined;
    process.chdir(fileURLToPath(new URL("..", import.meta.url)));
    // The app's modules make their API clients as they load, which fails without XAI_API_KEY, so they're loaded here,
    // where that failure prints as JSON like any other.
    const { caption, draft, estimate, film, presenters, preview, revise, show } = await import("./api.ts");
    const steps = { onProgress: (message: string) => void process.stderr.write(`${message}\n`), signal: stopping.signal };
    const { presenter, personality } = values;
    const [name = "", ...said] = words;
    const project = () => {
      if (!name) throw new Error("Name the video: the project draft returned, which is its folder's name in output/.");
      return name;
    };
    const commands: Record<string, () => Promise<unknown>> = {
      presenters: () => presenters(),
      draft: () => draft(withNotes(words.join(" "), notes), { presenter, personality, pullRequest, goAhead: values["go-ahead"], ...steps }),
      revise: () => revise(project(), withNotes(said.join(" "), notes), { personality, ...steps }),
      show: () => show(project()),
      estimate: () => estimate(project(), { presenter }),
      preview: () => preview(project(), { presenter, ...steps }),
      film: () => film(project(), { presenter, maxUsd: dollars(values["max-usd"]), ...steps }),
      caption: () => caption(project(), values.platform),
    };
    const step = commands[command];
    if (!step) throw new Error(`There's no ${command} command. Run it with --help to see the commands.`);
    print(await step());
  }
} catch (error) {
  print({ error: stopping.signal.aborted ? STOPPED : describe(error) });
  process.exitCode = 1;
}

function print(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// A connection that fails says only "fetch failed", so what failed underneath it goes along, like a timeout or a reset.
function describe(error: unknown): string {
  const said: string[] = [];
  for (let at: unknown = error; at instanceof Error && said.length < 4; at = at.cause) {
    const text = at.message || (at as Error & { code?: string }).code;
    if (text && !said.includes(text)) said.push(text);
  }
  return said.join(": ") || String(error);
}

// A text file, like notes or a Slack thread, goes with what was typed, after it.
function withNotes(typed: string, notes: string): string {
  return [typed.trim(), notes.trim()].filter(Boolean).join("\n\n");
}

function dollars(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const amount = Number(text.replace(/^\$/, ""));
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`--max-usd takes an amount in dollars, like 25, not "${text}".`);
  return amount;
}

function parseJson(text: string, file: string): GitHubPullRequest {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
