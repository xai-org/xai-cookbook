import { fileURLToPath } from "node:url";
import { SpaceXAI } from "@xai-official/sdk";
import { mcp } from "@xai-official/sdk/tools";
import { makeStore } from "./make-store.ts";
import { type McpServer, type ServerRequest, startMcpServer } from "./mcp-server.ts";
import { openTunnel } from "./tunnel.ts";

// A request turned away before Grok starts answering, for example by a rate limit, hasn't called the
// MCP server yet, so it's safe to send again. It's retried up to five times.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

export const SAMPLE_QUESTION = "Which products sold best last month?";
// The MCP server's tools that Grok may call. A tool the server adds later stays out until it's listed here.
export const ALLOWED_TOOLS = ["list_tables", "describe_table", "run_query"];
const DATABASE = fileURLToPath(new URL("../store.db", import.meta.url));

export type Store = McpServer & { url: string };
// One call Grok made to the MCP server. `output` is what the tool returned, parsed from JSON.
export type Step = { id: string; tool: string; arguments: Record<string, unknown>; output?: unknown; error?: string };
export type Answer = { text: string; steps: Step[]; cost: number };

export type AskEvents = {
  reasoning?: (text: string) => void;
  calling?: (id: string, tool: string) => void;
  called?: (step: Step) => void;
  text?: (text: string) => void;
  // A request that reached the MCP server, from the server's side.
  request?: (request: ServerRequest) => void;
};

// Builds the sample database, serves it over MCP on `port`, and gives the server a public URL, because
// SpaceXAI connects to MCP servers from its own servers.
export async function openStore(port: number): Promise<Store> {
  makeStore(DATABASE);
  const server = await startMcpServer(DATABASE, port);
  const tunnel = process.env.MCP_PUBLIC_URL ? { url: process.env.MCP_PUBLIC_URL, close: () => {} } : await openTunnel(port);
  return {
    url: new URL("/mcp", tunnel.url).href,
    issueToken: server.issueToken,
    close: () => {
      tunnel.close();
      server.close();
    },
  };
}

// Asks Grok a question about the store. SpaceXAI calls the MCP server itself, so there's no tool loop
// here: the stream reports each call as it starts and finishes.
export async function ask(question: string, store: Store, on: AskEvents = {}, signal?: AbortSignal): Promise<Answer> {
  // A token for this answer only. The server turns it away once Grok is done.
  const { token, revoke } = store.issueToken(on.request);
  const steps: Step[] = [];
  try {
    const stream = await client.responses.create(
      {
        model: "grok-4.7",
        // Grok reasons again after every call to the MCP server. At the default effort it gave the same
        // answers to the sample questions but took up to twice as long, with extra queries to check its work.
        reasoning: { effort: "low" },
        instructions: `You answer questions about a small online coffee store with the store tools, which run read-only SQL on its SQLite database. Today is ${new Date().toISOString().slice(0, 10)}.
Before you write SQL, list the tables and describe the ones you need, so you use the real column names and know what the values mean. Let SQL do the counting and adding up.
Answer in two to four plain sentences, without Markdown, with the numbers that back up the answer.`,
        input: question,
        tools: [
          mcp({
            server_url: store.url,
            server_label: "store",
            server_description: "The coffee store's SQLite database, with customers, products, orders, and order items. Read-only.",
            allowed_tools: ALLOWED_TOOLS,
            authorization: token,
          }),
        ],
        max_turns: 10,
        stream: true,
      },
      { signal },
    );
    const response = await stream
      .on("reasoning", (text) => on.reasoning?.(text))
      .on("response.output_item.added", ({ item }) => {
        if (item.type === "mcp_call" && "name" in item) on.calling?.(item.id ?? "", item.name);
      })
      .on("server_tool_call", (call) => {
        if (call.type !== "mcp_call") return;
        const step = { id: call.id ?? "", tool: call.name, arguments: JSON.parse(call.arguments || "{}"), ...readOutput(call.output, call.error) };
        steps.push(step);
        on.called?.(step);
      })
      .on("text", (text) => on.text?.(text))
      .done();
    return { text: response.toText(), steps, cost: response.usage.cost_usd ?? 0 };
  } finally {
    revoke();
  }
}

// The call's output is the MCP result as JSON, and the store's tools put their own JSON in its text.
// When a tool fails, the API puts its message in `error` instead, after the tool's name in brackets.
function readOutput(output: string, error?: string): { output?: unknown; error?: string } {
  if (error) return { error: error.replace(/^\[[^\]]*\]\s*/, "") };
  const result = JSON.parse(output || "{}") as { content?: Array<{ text?: string }>; isError?: boolean };
  const text = result.content?.map((part) => part.text ?? "").join("") ?? "";
  if (result.isError) return { error: text };
  try {
    return { output: JSON.parse(text) };
  } catch {
    return { output: text };
  }
}
