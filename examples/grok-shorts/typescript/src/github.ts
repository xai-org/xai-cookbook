// One line of a file's diff. Additions and deletions are marked, and unchanged lines are there for context.
export type Row = {
  kind: "hunk" | "add" | "del" | "same";
  text: string;
  // Where the line is in the file before and after the change. A hunk header has neither.
  oldLine?: number;
  newLine?: number;
};

export type ChangedFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  // Empty for binary files, and for diffs too big for GitHub to include.
  rows: Row[];
};

export type PullRequest = {
  url: string;
  repo: string;
  number: number;
  title: string;
  description: string;
  author: string;
  base: string;
  head: string;
  // The first line of each commit message.
  commits: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  files: ChangedFile[];
};

type GitHubPull = {
  html_url: string;
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  base: { ref: string; repo: { full_name: string } };
  head: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
};
type GitHubFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };
type GitHubCommit = { commit: { message: string } };

export function parsePullRequestUrl(url: string): { owner: string; repo: string; number: number } {
  const match = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i);
  if (!match) throw new Error(`"${url}" isn't a link to a pull request, like https://github.com/owner/repo/pull/123.`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

// Reads a pull request with three calls to the GitHub API. A pull request with more than 100 files only
// gets its first 100, which is more than a two-minute video can cover anyway.
export async function readPullRequest(url: string, signal?: AbortSignal): Promise<PullRequest> {
  const { owner, repo, number } = parsePullRequestUrl(url);
  const path = `/repos/${owner}/${repo}/pulls/${number}`;
  const [pull, files, commits] = await Promise.all([
    github<GitHubPull>(path, signal),
    github<GitHubFile[]>(`${path}/files?per_page=100`, signal),
    github<GitHubCommit[]>(`${path}/commits?per_page=100`, signal),
  ]);
  return {
    url: pull.html_url,
    repo: pull.base.repo.full_name,
    number: pull.number,
    title: pull.title,
    description: pull.body?.trim() ?? "",
    author: pull.user.login,
    base: pull.base.ref,
    head: pull.head.ref,
    commits: commits.map(({ commit }) => commit.message.split("\n")[0]),
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    files: files.map((file) => ({
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      rows: file.patch ? parsePatch(file.patch) : [],
    })),
  };
}

// Public repositories work without a token, at 60 requests an hour. A token raises that to 5,000 and
// opens private repositories it has access to.
async function github<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "SpaceXSI cookbook",
      "x-github-api-version": "2022-11-28",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    signal,
  });
  if (response.status === 404) {
    throw new Error(`GitHub couldn't find that pull request.${token ? "" : " For a private repository, set GITHUB_TOKEN."}`);
  }
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
    throw new Error("GitHub's rate limit is used up. Without a token it allows 60 requests an hour, so set GITHUB_TOKEN to raise it.");
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  return (await response.json()) as T;
}

// Splits a file's patch into rows, numbering each line as it is in the file before and after the change.
function parsePatch(patch: string): Row[] {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.replace(/\n$/, "").split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), oldLine: oldLine++ });
    } else if (!line.startsWith("\\")) {
      // A line starting with a backslash is git's "No newline at end of file" note, not part of the file.
      rows.push({ kind: "same", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return rows;
}
