import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SpaceXAI, type Tool } from "@xai-official/sdk";
import { mcp } from "@xai-official/sdk/tools";

const client = new SpaceXAI({ maxRetries: 2 });

// A remote MCP server Grok can read from while it researches a video, like Slack for a thread, GitHub for an issue, or
// Notion for a doc. Grok calls it through the API itself, with `token` as its bearer token, and only `tools` if they're
// listed. They're the apps on the Apps page, saved in output/apps.json, which stays on this computer.
export type Source = { id: string; name: string; url: string; token?: string; about: string; tools?: string[]; enabled: boolean };

// Servers to start from, with the kind of token each one takes. GitHub's is its read-only server, without the tools that
// open pull requests or comment, since a video only needs to read.
export const PRESETS = [
  { name: "GitHub", url: "https://api.githubcopilot.com/mcp/readonly", about: "GitHub repositories, issues, pull requests, discussions, and releases", token: "A GitHub token, like the one `gh auth token` prints" },
  { name: "Slack", url: "https://mcp.slack.com/mcp", about: "Slack channels, threads, and messages", token: "A Slack user token from a Slack app with the MCP server turned on" },
  { name: "Notion", url: "https://mcp.notion.com/mcp", about: "Notion pages and databases", token: "A Notion OAuth token" },
  { name: "Linear", url: "https://mcp.linear.app/mcp", about: "Linear issues, projects, and comments", token: "A Linear API key" },
  { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", about: "Documentation written for public GitHub repositories", token: "" },
];

const FILE = "output/apps.json";

export async function listSources(): Promise<Source[]> {
  return existsSync(FILE) ? JSON.parse(await readFile(FILE, "utf8")) : [];
}

// Saves a source from what the Apps page sent, in place of one with the same name. A token left empty keeps the one
// saved before.
export async function saveSource(sent: Partial<Source>): Promise<Source> {
  const name = String(sent.name ?? "").trim().slice(0, 40);
  const url = String(sent.url ?? "").trim();
  if (!name) throw new Error("Give the source a name.");
  if (!/^https:\/\/\S+$/.test(url)) throw new Error("The server's address has to start with https://.");
  const sources = await listSources();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "source";
  const before = sources.find((source) => source.id === id);
  const tools = (Array.isArray(sent.tools) ? sent.tools : String(sent.tools ?? "").split(",")).map((tool) => String(tool).trim()).filter(Boolean);
  const source: Source = { id, name, url, token: String(sent.token ?? "").trim() || before?.token, about: String(sent.about ?? "").trim().slice(0, 200), tools: tools.length ? tools : undefined, enabled: sent.enabled ?? true };
  await mkdir("output", { recursive: true });
  await writeFile(FILE, JSON.stringify([...sources.filter((each) => each.id !== id), source], null, 2));
  return source;
}

export async function removeSource(id: string): Promise<void> {
  await writeFile(FILE, JSON.stringify((await listSources()).filter((source) => source.id !== id), null, 2));
}

// The tools Grok can read the turned-on sources with.
export async function sourceTools(): Promise<Tool[]> {
  return (await listSources()).filter((source) => source.enabled).map(toolOf);
}

// What Grok is told about the turned-on sources, so it reads a link from one of them there.
export async function sourcesBrief(): Promise<string> {
  const sources = (await listSources()).filter((source) => source.enabled);
  if (!sources.length) return "";
  return `You can also read these sources with their tools:\n${sources.map((source) => `- ${source.name}: ${source.about || source.url}`).join("\n")}\nWhen I link to something in one of them, like a thread, an issue, or a doc, read it there before anything else, and treat what it says as the facts the video is about. Only ever read from them: never create, change, send, or delete anything in them.`;
}

// Checks that Grok can reach a source, and returns the tools it has there.
export async function testSource(source: Source, signal?: AbortSignal): Promise<string[]> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [{ role: "user", content: `List the names of every tool you have from the ${source.id} server, without calling any of them.` }],
      tools: [toolOf(source)],
      text: { format: { type: "json_schema", name: "tools", schema: { type: "object", properties: { tools: { type: "array", items: { type: "string" } } }, required: ["tools"], additionalProperties: false } } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  return (response.toJson() as { tools: string[] }).tools;
}

function toolOf(source: Source): Tool {
  return mcp({ server_url: source.url, server_label: source.id, server_description: source.about || undefined, authorization: source.token || undefined, allowed_tools: source.tools?.length ? source.tools : undefined });
}
