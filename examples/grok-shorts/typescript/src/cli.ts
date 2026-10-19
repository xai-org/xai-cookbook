import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Brand } from "./brand.ts";
import { type GitHubPullRequest, pullRequestFrom } from "./github.ts";

// Everything the web app does, from the terminal, for scripts and agents. Each command prints its result as JSON on
// stdout, and what it's doing along the way on stderr. A step that fails prints {"error": "..."} and exits with 1.
const USAGE = `Grok Shorts from the terminal. Each command prints its result as JSON.
Run it as: npm run -s shorts -- <command>

Make a video
  options                                   Presenters, personalities, themes, layouts, and platforms
  list                                      Every video, newest first
  draft "<link or idea>"                    Start a video and write its script, or Grok's questions
        [--presenter <id>] [--personality <id or @handle>] [--file <notes.md>] [--pr <pull-request.json>] [--go-ahead]
  revise <project> ["<message>"]            Answer Grok, or ask for changes. Pending notes go with it
        [--personality <id or @handle>] [--file <notes.md>]
  show <project>                            The script, estimate, sound, notes, and versions
  visuals <project>                         Get what each beat shows, before filming
  estimate <project> [--presenter <id>]     What filming would cost now
  changes <project> [--presenter <id>]      What changed since the current version
  preview <project> [--presenter <id>]      Watch it with text to speech, for a fraction of a cent
  film <project> [--presenter <id>] [--max-usd <dollars>]
  caption <project> [--platform shorts|tiktok|reels]
  hooks <project>                           Score the hook and write four others
  batch "<source>" "<source>" ...           Several scripts at once, each previewed
        [--presenter <id>] [--personality <id>] [--no-preview]
  batches

Change it by hand
  line <project> <segment> "<line>"
  layout <project> <segment> <split|full|overlay|green|bubble|visual>
  theme <project> <theme>
  move <project> <segment> <to>
  drop <project> <segment>
  trim <project> <segment> [--head <seconds>] [--tail <seconds>]
  use-upload <project> <segment> <upload>
  sound <project> [--music <upload>|none] [--volume <0 to 1>] [--effects on|off]
  on-screen <project> [--title on|off] [--labels on|off]
  takes <project>
  pick-take <project> <segment> <letter>
  retake <project> <segment> "<direction>" [--max-usd <dollars>]

Versions and notes
  restore <project> <version>
  cover <project> [--at <seconds>] [--version <n>]
  note <project> "<what should change>" --at <seconds> [--x <0 to 1>] [--y <0 to 1>] [--version <n>]
  notes <project>
  remove-note <project> <note>
  review <project> [--version <n>]

Library, brand kit, and apps
  library [list | add <file> [--name <name>] | remove <upload>]
  brand [show | set | logo <file> | remove-logo | website <url> [--save]]
        set: [--name] [--colors <#hex,#hex>] [--text <#hex>] [--font <id>] [--look <theme>] [--glow on|off]
             [--watermark on|off] [--end-card on|off] [--end-card-line <text>] [--presenter <id>]
  apps [list | add | remove <id> | on <id> | off <id> | test <id>]
        add: [--preset <name>] [--name] [--url] [--token] [--about] [--tools <a,b>] [--enabled on|off]

Presenters and personalities
  voices
  speak "<text>" (--voice <id> | --presenter <id>)
  presenter invent ["<idea>"]
  presenter from-video <video> --consent [--at <seconds>] [--clone-voice] [--name <name>]
  presenter portraits --look "<how they look>" --room "<where they film>" [--likeness <frame>]
  presenter screen-test <portrait> --voice <id> [--room] [--delivery] [--line]
  presenter save --portrait <portrait> --name <name> --look "..." --room "..." --voice <id> [--personality <id>]
  presenter save --id <presenter> [--name] [--voice <id>] [--personality <id>]
  personality write ["<idea or @handle>"]
  personality lines --file <personality.json> [--topic "<topic>"]
  personality save --file <personality.json>
  personality screen-test --presenter <id> --line "<line>" --delivery "<how they act>"

<project> is the name draft returns, the video's folder in output/. Segments and versions are numbered from 1, the way
show lists them.`;
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
      "no-preview": { type: "boolean" },
      at: { type: "string" },
      x: { type: "string" },
      y: { type: "string" },
      version: { type: "string" },
      head: { type: "string" },
      tail: { type: "string" },
      music: { type: "string" },
      volume: { type: "string" },
      effects: { type: "string" },
      title: { type: "string" },
      labels: { type: "string" },
      name: { type: "string" },
      colors: { type: "string" },
      text: { type: "string" },
      font: { type: "string" },
      look: { type: "string" },
      glow: { type: "string" },
      watermark: { type: "string" },
      "end-card": { type: "string" },
      "end-card-line": { type: "string" },
      save: { type: "boolean" },
      preset: { type: "string" },
      url: { type: "string" },
      token: { type: "string" },
      about: { type: "string" },
      tools: { type: "string" },
      enabled: { type: "string" },
      id: { type: "string" },
      room: { type: "string" },
      voice: { type: "string" },
      portrait: { type: "string" },
      likeness: { type: "string" },
      consent: { type: "boolean" },
      "clone-voice": { type: "boolean" },
      line: { type: "string" },
      delivery: { type: "string" },
      topic: { type: "string" },
      summary: { type: "string" },
      style: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...words] = positionals;
  if (!command || values.help) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    // Files are named from where the command runs, and the app works from its own folder, where output/ is.
    const origin = process.cwd();
    const here = (file: string | undefined, what: string) => {
      if (!file) throw new Error(`Give ${what}.`);
      return resolve(origin, file);
    };
    process.chdir(fileURLToPath(new URL("..", import.meta.url)));
    // The app's modules make their API clients as they load, which fails without XAI_API_KEY, so they're loaded here,
    // where that failure prints as JSON like any other.
    const api = await import("./api.ts");
    const steps = { onProgress: (message: string) => void process.stderr.write(`${message}\n`), signal: stopping.signal };
    const { presenter, personality } = values;
    const [name = "", ...rest] = words;
    const project = () => {
      if (!name) throw new Error("Name the video: the project draft returned, which is its folder's name in output/.");
      return name;
    };
    const segment = (at: number) => count(rest[at - 1], "segment");
    const said = (from: number, what: string) => {
      const text = rest.slice(from - 1).join(" ").trim();
      if (!text) throw new Error(`Write ${what}.`);
      return text;
    };
    const notes = async () => (values.file ? await readFile(here(values.file, "a file"), "utf8") : "");
    const flag = (key: "x" | "y" | "head" | "tail" | "volume") => amount(values[key], `--${key}`);
    const onOff = (key: "effects" | "title" | "labels" | "glow" | "watermark" | "end-card" | "enabled") => toggle(values[key], `--${key}`);
    const version = () => (values.version === undefined ? undefined : count(values.version, "version"));
    // A personality from a file that `personality write` printed, with any part of it given on its own instead.
    const persona = async () => {
      const read = values.file ? JSON.parse(await readFile(here(values.file, "a file"), "utf8")) : {};
      return { ...read, ...Object.fromEntries((["name", "summary", "style", "delivery"] as const).flatMap((key) => (values[key] === undefined ? [] : [[key, values[key]]]))) };
    };
    const action = (allowed: string[]) => {
      const picked = name || allowed[0];
      if (!allowed.includes(picked)) throw new Error(`There's no ${command} ${picked} command. Pick one of: ${allowed.join(", ")}.`);
      return picked;
    };
    const commands: Record<string, () => Promise<unknown>> = {
      options: () => api.options(),
      list: () => api.list(),
      draft: async () => {
        const pullRequest = values.pr ? pullRequestFrom(parseJson(await readFile(here(values.pr, "a file"), "utf8"), values.pr)) : undefined;
        return api.draft(withNotes(words.join(" "), await notes()), { presenter, personality, pullRequest, goAhead: values["go-ahead"], ...steps });
      },
      revise: async () => api.revise(project(), withNotes(rest.join(" "), await notes()), { personality, ...steps }),
      show: () => api.show(project()),
      visuals: () => api.visuals(project(), steps),
      estimate: () => api.estimate(project(), { presenter }),
      changes: () => api.changes(project(), { presenter }),
      preview: () => api.preview(project(), { presenter, ...steps }),
      film: () => api.film(project(), { presenter, maxUsd: dollars(values["max-usd"]), ...steps }),
      caption: () => api.caption(project(), values.platform),
      hooks: () => api.hooks(project()),
      batch: () => api.batch(words, { presenter, personality, preview: !values["no-preview"], ...steps }),
      batches: () => api.batches(),
      line: () => api.line(project(), segment(1), said(2, "the line")),
      layout: () => api.layout(project(), segment(1), said(2, "a layout")),
      theme: () => api.theme(project(), said(1, "a theme")),
      move: () => api.move(project(), segment(1), count(rest[1], "place to move it to")),
      drop: () => api.drop(project(), segment(1)),
      trim: () => api.trim(project(), segment(1), { head: flag("head"), tail: flag("tail") }),
      "use-upload": () => api.useUpload(project(), segment(1), said(2, "the upload's id")),
      sound: () => api.sound(project(), { music: values.music, volume: flag("volume"), effects: onOff("effects") }),
      "on-screen": () => api.onScreen(project(), { title: onOff("title"), labels: onOff("labels") }),
      takes: () => api.takes(project(), { presenter }),
      "pick-take": () => api.pickTake(project(), segment(1), said(2, "the take's letter"), { presenter }),
      retake: () => api.retake(project(), segment(1), said(2, "how to act the retake"), { presenter, maxUsd: dollars(values["max-usd"]), ...steps }),
      restore: () => api.restore(project(), count(rest[0], "version")),
      cover: () => api.cover(project(), { at: seconds(values.at), version: version() }),
      note: () => api.note(project(), said(1, "what should change"), { at: seconds(values.at), x: flag("x"), y: flag("y"), version: version() }),
      notes: () => api.notes(project()),
      "remove-note": () => api.removeNote(project(), said(1, "the note's id")),
      review: () => api.review(project(), { version: version(), signal: stopping.signal }),
      voices: () => api.voices(),
      speak: () => api.speak(words.join(" "), { voice: values.voice, presenter }),
      library: async () => {
        const picked = action(["list", "add", "remove"]);
        if (picked === "add") return api.library.add(here(rest[0], "a file to add"), values.name);
        if (picked === "remove") return api.library.remove(said(1, "the upload's id"));
        return api.library.list();
      },
      brand: async () => {
        const picked = action(["show", "set", "logo", "remove-logo", "website"]);
        if (picked === "set") {
          const colors = values.colors?.split(",").map((color) => color.trim());
          return api.brand.set({ name: values.name, colors, text: values.text, font: values.font, look: values.look as Brand["look"], glow: onOff("glow"), watermark: onOff("watermark"), presenter, endCard: { on: onOff("end-card"), line: values["end-card-line"] } });
        }
        if (picked === "logo") return api.brand.logo(here(rest[0], "the logo's file"));
        if (picked === "remove-logo") return api.brand.removeLogo();
        if (picked === "website") return api.brand.fromWebsite(said(1, "the website"), { save: values.save, signal: stopping.signal });
        return api.brand.show();
      },
      apps: async () => {
        const picked = action(["list", "add", "remove", "on", "off", "test"]);
        if (picked === "add") {
          const tools = values.tools?.split(",").map((tool) => tool.trim()).filter(Boolean);
          return api.apps.add({ preset: values.preset, name: values.name, url: values.url, token: values.token, about: values.about, tools, enabled: onOff("enabled") });
        }
        if (picked === "remove") return api.apps.remove(said(1, "the app's id"));
        if (picked === "on" || picked === "off") return api.apps.turn(said(1, "the app's id"), picked === "on");
        if (picked === "test") return api.apps.test(said(1, "the app's id"));
        return api.apps.list();
      },
      presenter: async () => {
        const picked = action(["invent", "from-video", "portraits", "screen-test", "save"]);
        if (picked === "from-video") return api.presenter.fromVideo(here(rest[0], "the video"), { consent: values.consent, at: seconds(values.at), cloneVoice: values["clone-voice"], name: values.name, signal: stopping.signal });
        if (picked === "portraits") return api.presenter.portraits({ look: values.look, room: values.room, likeness: values.likeness && here(values.likeness, "a frame"), signal: stopping.signal });
        if (picked === "screen-test") return api.presenter.screenTest(here(rest[0], "a portrait"), { voice: values.voice, room: values.room, delivery: values.delivery, line: values.line, ...steps });
        if (picked === "save") return api.presenter.save({ id: values.id, name: values.name, look: values.look, room: values.room, voice: values.voice, portrait: values.portrait && here(values.portrait, "a portrait"), personality });
        return api.presenter.invent(rest.join(" "));
      },
      personality: async () => {
        const picked = action(["write", "lines", "save", "screen-test"]);
        if (picked === "lines") return api.personality.lines(await persona(), values.topic);
        if (picked === "save") return api.personality.save(await persona());
        if (picked === "screen-test") return api.personality.screenTest({ presenter, line: values.line, delivery: values.delivery, ...steps });
        return api.personality.write(rest.join(" "));
      },
    };
    const step = commands[command];
    if (!step) throw new Error(`There's no ${command} command. Run it with --help to see the commands.`);
    print(await step());
  }
} catch (error) {
  if (stopping.signal.aborted) {
    // A batch keeps writing in the background, so the process ends here once the message is out.
    print({ error: STOPPED }, () => process.exit(1));
  } else {
    print({ error: describe(error) });
    process.exitCode = 1;
  }
}

function print(result: unknown, then?: () => void): void {
  process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`, then);
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

function count(text: string | undefined, what: string): number {
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Give the ${what}'s number, counting from 1${text === undefined ? "" : `, not "${text}"`}.`);
  return number;
}

function amount(text: string | undefined, what: string): number | undefined {
  if (text === undefined) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${what} takes a number, not "${text}".`);
  return number;
}

function dollars(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const number = Number(text.replace(/^\$/, ""));
  if (!Number.isFinite(number) || number < 0) throw new Error(`--max-usd takes an amount in dollars, like 25, not "${text}".`);
  return number;
}

// Seconds, like 12.5, or minutes and seconds, like 0:12.5.
function seconds(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const parts = text.split(":").map(Number);
  const total = parts.reduce((sum, part) => sum * 60 + part, 0);
  if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) throw new Error(`--at takes seconds, like 12.5, or minutes and seconds, like 0:12.5, not "${text}".`);
  return total;
}

function toggle(text: string | undefined, what: string): boolean | undefined {
  if (text === undefined) return undefined;
  if (/^(on|yes|true)$/i.test(text)) return true;
  if (/^(off|no|false)$/i.test(text)) return false;
  throw new Error(`${what} takes on or off, not "${text}".`);
}

function parseJson(text: string, file: string): GitHubPullRequest {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
