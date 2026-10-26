// An MCP server over Streamable HTTP that gives Grok a long-term memory for one user at a time.
import { type SupabaseContext, withSupabase } from "@supabase/server";

type Db = SupabaseContext["supabase"];
// The Edge Runtime provides Supabase.ai. This declares the part used here, so `deno check` passes.
declare const Supabase: { ai: { Session: new (model: "gte-small") => { run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown> } } };

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_MEMORY_CHARS = 500;
const embedder = new Supabase.ai.Session("gte-small");

const TOOLS = [
  {
    name: "store_memory",
    description: "Saves one short fact about the user, in the third person, so you can recall it in later conversations.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string", description: `One fact, at most ${MAX_MEMORY_CHARS} characters, like "Has a cat named Miso."` } },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "search_memories",
    description: "Finds the saved facts about the user closest in meaning to a query, best match first.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to know, like \"pets\" or \"food preferences\"" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "How many memories to return. Defaults to 5." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "forget_memory",
    description: "Deletes one saved fact by its id, which search_memories returns.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The memory's id" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
];

type Answer = { result?: object; error?: { code: number; message: string } };

export default {
  fetch: withSupabase({ auth: "user" }, (req, ctx) => handle(req, ctx.supabase)),
};

async function handle(req: Request, supabase: Db): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const message = await req.json().catch(() => undefined);
  if (typeof message?.method !== "string") {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
  }
  if (message.id === undefined) return new Response(null, { status: 202 });
  const { result, error } = await answer(supabase, message.method, message.params ?? {});
  return Response.json({ jsonrpc: "2.0", id: message.id, ...(error ? { error } : { result }) });
}

async function answer(supabase: Db, method: string, params: { protocolVersion?: unknown; name?: unknown; arguments?: Record<string, unknown> }): Promise<Answer> {
  if (method === "initialize") {
    const version = PROTOCOL_VERSIONS.find((v) => v === params.protocolVersion) ?? PROTOCOL_VERSIONS[0];
    return { result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "memory", version: "1.0.0" } } };
  }
  if (method === "ping") return { result: {} };
  if (method === "tools/list") return { result: { tools: TOOLS } };
  if (method !== "tools/call") return { error: { code: -32601, message: `Method not found: ${method}` } };
  try {
    const output = await callTool(supabase, String(params.name), params.arguments ?? {});
    return { result: { content: [{ type: "text", text: JSON.stringify(output) }] } };
  } catch (error) {
    return { result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } };
  }
}

async function callTool(supabase: Db, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "store_memory") {
    const content = String(args.content ?? "").trim();
    if (!content || content.length > MAX_MEMORY_CHARS) throw new Error(`A memory must be 1 to ${MAX_MEMORY_CHARS} characters.`);
    // SpaceXSI can send the same call more than once, so saving a memory the user already has returns the saved row.
    const { data, error } = await supabase.from("memories")
      .upsert({ content, embedding: await embed(content) }, { onConflict: "user_id,content", ignoreDuplicates: true })
      .select("id, content, created_at").maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { stored: data };
    const existing = await supabase.from("memories").select("id, content, created_at").eq("content", content).single();
    if (existing.error) throw new Error(existing.error.message);
    return { stored: existing.data };
  }
  if (name === "search_memories") {
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const { data, error } = await supabase.rpc("match_memories", { query_embedding: await embed(String(args.query ?? "")), match_count: limit });
    if (error) throw new Error(error.message);
    return { memories: data };
  }
  if (name === "forget_memory") {
    const { data, error } = await supabase.from("memories").delete().eq("id", String(args.id)).select("id, content");
    if (error) throw new Error(error.message);
    if (!data.length) throw new Error(`No memory with id ${args.id}.`);
    return { forgotten: data[0] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function embed(text: string): Promise<string> {
  const vector = (await embedder.run(text, { mean_pool: true, normalize: true })) as number[];
  return JSON.stringify(vector);
}
