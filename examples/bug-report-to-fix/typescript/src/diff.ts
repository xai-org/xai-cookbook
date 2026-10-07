export type FileChange = { path: string; status: "added" | "modified" | "deleted"; added: number; removed: number; patch: string };

type Line = { kind: " " | "-" | "+"; text: string };

// Lines of unchanged code to show around each change, like git diff.
const CONTEXT = 3;
// Past this many lines times lines, the file is shown as replaced instead of diffed line by line.
const MAX_CELLS = 4_000_000;

// A unified diff of one file, in the format git diff prints and git apply reads.
export function diffFile(path: string, before: string | undefined, after: string | undefined): FileChange {
  const lines = diffLines(splitLines(before), splitLines(after));
  const header = `--- ${before === undefined ? "/dev/null" : `a/${path}`}\n+++ ${after === undefined ? "/dev/null" : `b/${path}`}\n`;
  return {
    path,
    status: before === undefined ? "added" : after === undefined ? "deleted" : "modified",
    added: lines.filter((line) => line.kind === "+").length,
    removed: lines.filter((line) => line.kind === "-").length,
    patch: header + hunks(lines).join(""),
  };
}

function splitLines(text: string | undefined): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// The longest run of lines the two versions share stays, and everything else is removed or added.
function diffLines(a: string[], b: string[]): Line[] {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: "-" as const, text })), ...b.map((text) => ({ kind: "+" as const, text }))];
  }
  // shared[i][j] is how many lines a[i..] and b[j..] have in common, in order.
  const shared = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      shared[i][j] = a[i] === b[j] ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1]);
    }
  }
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: " ", text: a[i++] });
      j++;
    } else if (j >= b.length || (i < a.length && shared[i + 1][j] >= shared[i][j + 1])) {
      lines.push({ kind: "-", text: a[i++] });
    } else {
      lines.push({ kind: "+", text: b[j++] });
    }
  }
  return lines;
}

// Groups the changes into hunks, each with a header that says where it starts in both versions.
function hunks(lines: Line[]): string[] {
  const changed = lines.flatMap((line, index) => (line.kind === " " ? [] : [index]));
  const result: string[] = [];
  for (let first = 0; first < changed.length; ) {
    let last = first;
    while (last + 1 < changed.length && changed[last + 1] - changed[last] <= 2 * CONTEXT + 1) last++;
    const from = Math.max(0, changed[first] - CONTEXT);
    const to = Math.min(lines.length, changed[last] + CONTEXT + 1);
    const before = lines.slice(0, from);
    const hunk = lines.slice(from, to);
    const oldStart = before.filter((line) => line.kind !== "+").length;
    const newStart = before.filter((line) => line.kind !== "-").length;
    const oldCount = hunk.filter((line) => line.kind !== "+").length;
    const newCount = hunk.filter((line) => line.kind !== "-").length;
    // An empty side starts at the line before the hunk, so a new file's hunk starts at 0.
    const range = (start: number, count: number) => `${count ? start + 1 : start},${count}`;
    result.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n`);
    for (const line of hunk) result.push(`${line.kind}${line.text}\n`);
    first = last + 1;
  }
  return result;
}
