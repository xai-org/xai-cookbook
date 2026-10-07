import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type FileChange, diffFile } from "./diff.ts";

export const SAMPLE_REPO = fileURLToPath(new URL("../sample-repo", import.meta.url));

// The longest any command may run, and how much of each of its output streams goes back to the model.
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 10_000;
const MAX_FILE_BYTES = 200_000;

export type CommandResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean };
export type Check = { argv: string[] } | { reason: string };
type Rule = { flags?: RegExp; values?: Record<string, RegExp>; pattern?: boolean };

const DIGITS = /^\d+$/;
const ANY = /^[\s\S]*$/;
// The commands that run without asking: they only read files, and every word that isn't a flag or a
// search pattern is a path that has to stay inside the repo.
const RULES: Record<string, Rule> = {
  ls: { flags: /^-[1aAlhRtrSF]+$/ },
  cat: { flags: /^-n$/ },
  head: { flags: /^-\d+$/, values: { "-n": DIGITS } },
  tail: { flags: /^-\d+$/, values: { "-n": DIGITS } },
  wc: { flags: /^-[lwcm]+$/ },
  grep: { flags: /^(-[rRnilwvcEFHhos]+|--(include|exclude|exclude-dir)=.+)$/, values: { "-A": DIGITS, "-B": DIGITS, "-C": DIGITS, "-m": DIGITS }, pattern: true },
  find: { flags: /^-(not|print)$/, values: { "-name": ANY, "-iname": ANY, "-path": ANY, "-type": /^[fd]$/, "-maxdepth": DIGITS, "-mindepth": DIGITS } },
  pwd: {},
};
export const ALLOWED = [...Object.keys(RULES), "node --test", "npm test"];

// Copies the sample repo to dir/repo, a fresh folder for one run, and returns its real path, which is
// what the path checks compare against.
export async function createWorkspace(dir: string): Promise<string> {
  const root = join(dir, "repo");
  await mkdir(dir, { recursive: true });
  await cp(SAMPLE_REPO, root, { recursive: true });
  return realpath(root);
}

// Decides whether a command can run without asking. It returns the program and arguments to run, or the
// reason a person has to approve it.
export function checkCommand(command: string, root: string): Check {
  const words = splitWords(command);
  if (!words) return { reason: "it uses shell syntax, like a pipe, a redirect, a glob, or a variable" };
  if (!words.length) return { reason: "it's empty" };
  const [program, ...args] = words;
  if (program === "npm" && (args.join(" ") === "test" || args.join(" ") === "run test")) return { argv: testArgs(root, []) };
  if (program === "node") return args[0] === "--test" ? checkTests(args.slice(1), root) : { reason: "node only runs the tests here, as node --test" };
  const rule = RULES[program];
  if (!rule) return { reason: `${program} isn't on the allowlist` };
  let pattern = rule.pattern;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = rule.values?.[arg];
    if (value) {
      if (!value.test(args[++i] ?? "")) return { reason: `${program} ${arg} needs a different value` };
    } else if (arg.startsWith("-")) {
      if (!rule.flags?.test(arg)) return { reason: `${program} ${arg} isn't on the allowlist` };
    } else if (pattern) {
      pattern = false;
    } else if (!isInside(root, arg)) {
      return { reason: `${arg} is outside the repo` };
    }
  }
  return { argv: words };
}

function checkTests(args: string[], root: string): Check {
  for (const arg of args) {
    if (arg.startsWith("--test-name-pattern=")) continue;
    if (arg.startsWith("-")) return { reason: `node ${arg} isn't on the allowlist` };
    if (!isInside(root, arg)) return { reason: `${arg} is outside the repo` };
  }
  return { argv: testArgs(root, args) };
}

// The tests run the model's code, so they run under Node's permission model: they can read and write
// the repo and nothing else, and can't start other programs. Without child processes, every test file
// runs in one process.
export function testArgs(root: string, args: string[]): string[] {
  return [
    process.execPath,
    "--permission",
    `--allow-fs-read=${root}`,
    `--allow-fs-write=${root}`,
    "--experimental-test-isolation=none",
    "--test-reporter=spec",
    "--test",
    ...args,
  ];
}

// Runs a checked command directly, or an approved one through the shell, inside the repo. Neither gets
// this process's environment, which holds the API key.
export function runCommand(
  command: string[] | string,
  root: string,
  limits: { timeoutMs?: number | null; maxOutput?: number | null } = {},
  signal?: AbortSignal,
): Promise<CommandResult> {
  const timeoutMs = Math.min(limits.timeoutMs || TIMEOUT_MS, TIMEOUT_MS);
  const maxOutput = Math.min(limits.maxOutput || MAX_OUTPUT, MAX_OUTPUT);
  const [file, ...args] = typeof command === "string" ? ["/bin/sh", "-c", command] : command;
  return new Promise((done) => {
    const child = spawn(file, args, {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, LANG: process.env.LANG ?? "en_US.UTF-8", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a timeout or a stop also ends anything the command started.
      detached: true,
    });
    const stdout = keepEnds(maxOutput);
    const stderr = keepEnds(maxOutput);
    let timedOut = false;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    const finish = (exitCode: number) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      done({ stdout: stdout.text(), stderr: stderr.text(), exitCode, timedOut });
    };
    child.stdout.setEncoding("utf8").on("data", stdout.add);
    child.stderr.setEncoding("utf8").on("data", stderr.add);
    child.on("error", (error) => {
      stderr.add(`${error.message}\n`);
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

// The model's only way to change a file. It writes inside the repo or not at all.
export async function writeRepoFile(root: string, path: string, content: string): Promise<string> {
  if (!isInside(root, path)) throw new Error(`${path} is outside the repo`);
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error(`${path} would be larger than ${MAX_FILE_BYTES} bytes`);
  const target = resolve(root, path);
  if ((await lstat(target).catch(() => undefined))?.isSymbolicLink()) throw new Error(`${path} is a symbolic link`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content.endsWith("\n") ? content : `${content}\n`);
  return relative(root, target);
}

// Every file that differs from the sample repo, whether write_file or an approved command changed it.
export async function repoChanges(root: string): Promise<FileChange[]> {
  const [before, after] = await Promise.all([readTree(SAMPLE_REPO), readTree(root)]);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => diffFile(path, before.get(path), after.get(path)))
    .filter((change) => change.added || change.removed);
}

export async function listFiles(root: string): Promise<string[]> {
  return [...(await readTree(root)).keys()].sort();
}

async function readTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const path = relative(root, join(entry.parentPath, entry.name));
    if (!entry.isFile() || path.split(sep).some((part) => part === "node_modules" || part === ".git")) continue;
    files.set(path.split(sep).join("/"), await readFile(join(root, path), "utf8"));
  }
  return files;
}

// True if path stays inside root, even after following symbolic links.
function isInside(root: string, path: string): boolean {
  let target = resolve(root, path);
  if (!within(root, target)) return false;
  while (!existsSync(target)) target = dirname(target);
  return within(root, realpathSync(target));
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Splits a command into words, with quotes, the way a shell would. It returns nothing for characters a
// shell treats specially outside quotes, since there's no shell here to make them work.
function splitWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else if (/[|&;<>()$`\\*?[\]{}~]/.test(char)) {
      return undefined;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) words.push(word);
  return words;
}

// Keeps the start and the end of a stream, where commands print what matters most, and drops the middle.
function keepEnds(limit: number) {
  const half = Math.floor(limit / 2);
  let head = "";
  let tail = "";
  let dropped = 0;
  return {
    add: (chunk: string) => {
      const room = half - head.length;
      head += chunk.slice(0, Math.max(room, 0));
      tail += chunk.slice(Math.max(room, 0));
      if (tail.length > half) {
        dropped += tail.length - half;
        tail = tail.slice(-half);
      }
    },
    text: () => (dropped ? `${head}\n[${dropped} characters cut]\n${tail}` : head + tail),
  };
}
