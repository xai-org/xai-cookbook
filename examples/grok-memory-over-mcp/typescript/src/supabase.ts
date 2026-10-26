import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Session, type SupabaseClient, createClient } from "@supabase/supabase-js";

// Two people who share one memory server. A real app has the user type their password; these match supabase/seed.sql.
export const DEMO_USERS = {
  alice: { email: "alice@example.com", password: "alice-password", name: "Alice" },
  bob: { email: "bob@example.com", password: "bob-password", name: "Bob" },
} as const;
export type Who = keyof typeof DEMO_USERS;
export type User = { id: string; email: string; name: string };
export type Memory = { id: string; content: string; created_at: string };

export type Settings = { url: string; publishableKey: string; local: boolean };

// Reads the project's URL and publishable key from the environment (a hosted project), or from the
// local stack that `supabase start` runs.
export function supabaseSettings(): Settings {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
    return { url: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY, local: !process.env.SUPABASE_URL.startsWith("https://") };
  }
  try {
    const status = JSON.parse(
      execFileSync("supabase", ["status", "-o", "json"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    );
    if (!status.API_URL || !status.PUBLISHABLE_KEY) throw new Error("incomplete status");
    return { url: status.API_URL, publishableKey: status.PUBLISHABLE_KEY, local: true };
  } catch {
    throw new Error(
      "Couldn't reach the local Supabase stack. Run `supabase start` in examples/grok-memory-over-mcp/typescript, or set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for a hosted project.",
    );
  }
}

// The MCP server is an Edge Function named `memory`.
export const functionUrl = (url: string) => new URL("/functions/v1/memory", url).href;

export type SignedIn = { client: SupabaseClient; user: User };

// Signs in with the publishable key, like a browser app would. The session lives in memory only.
export async function signIn(settings: Settings, who: Who): Promise<SignedIn> {
  const { email, password, name } = DEMO_USERS[who];
  const client = createClient(settings.url, settings.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Couldn't sign in as ${email}: ${error.message}`);
  return { client, user: { id: data.user.id, email, name } };
}

// getSession() refreshes the token when it's about to expire, so each question carries a fresh one.
export async function accessToken(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("Not signed in");
  return (data.session as Session).access_token;
}

// The user's memories, newest first. Nothing here filters by user: row-level security does.
export async function listMemories(client: SupabaseClient): Promise<Memory[]> {
  const { data, error } = await client.from("memories").select("id, content, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data;
}

// Sends one JSON-RPC message to the memory function, the way SpaceXSI does.
export async function callMemoryTool(token: string, url: string, method: string, params?: object): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

// The first search in a fresh Edge Function worker loads the embedding model, which takes a few seconds.
// Doing it before the first question keeps that wait out of the answer.
export async function warmUp(settings: Settings, token: string): Promise<void> {
  await callMemoryTool(token, functionUrl(settings.url), "tools/call", { name: "search_memories", arguments: { query: "warm up", limit: 1 } });
}
