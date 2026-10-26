import assert from "node:assert/strict";
import { type Memory, callMemoryTool, functionUrl, listMemories, signIn, accessToken, supabaseSettings } from "./supabase.ts";

// Checks the memory server and its row-level security against the local stack, or the hosted project when
// SUPABASE_URL is set. It calls the Edge Function directly, so it needs no SpaceXSI API key.
let failed = false;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed = true;
    console.log(`✗ ${name}\n  ${error instanceof Error ? error.message : error}`);
  }
}

const settings = supabaseSettings();
const url = functionUrl(settings.url);
const tag = `[check ${Date.now()}]`;
const alice = await signIn(settings, "alice");
const bob = await signIn(settings, "bob");
const aliceToken = await accessToken(alice.client);
const bobToken = await accessToken(bob.client);
const call = (token: string, name: string, args: object) => callMemoryTool(token, url, "tools/call", { name, arguments: args });
const text = (reply: { body: any }) => reply.body.result.content[0].text as string;
const stored: Array<{ token: string; id: string }> = [];
let aliceMemory = "";
let bobMemory = "";

console.log(`${settings.local ? "Local stack" : "Hosted project"} at ${settings.url}`);
await check("signs in as Alice and Bob with the publishable key", async () => {
  assert.equal(alice.user.email, "alice@example.com");
  assert.equal(bob.user.email, "bob@example.com");
});

await check("speaks MCP: initialize, three tools, notifications, no GET", async () => {
  const init = await callMemoryTool(aliceToken, url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  const list = await callMemoryTool(aliceToken, url, "tools/list");
  assert.deepEqual(list.body.result.tools.map((tool: { name: string }) => tool.name).sort(), ["forget_memory", "search_memories", "store_memory"]);
  const notification = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${aliceToken}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(notification.status, 202);
  const get = await fetch(url, { headers: { authorization: `Bearer ${aliceToken}` } });
  assert.equal(get.status, 405);
});

await check("each user stores a memory", async () => {
  const a = await call(aliceToken, "store_memory", { content: `Has a cat named Miso. ${tag}` });
  const b = await call(bobToken, "store_memory", { content: `Has a dog named Biscuit. ${tag}` });
  aliceMemory = JSON.parse(text(a)).stored.id;
  bobMemory = JSON.parse(text(b)).stored.id;
  stored.push({ token: aliceToken, id: aliceMemory }, { token: bobToken, id: bobMemory });
});

await check("search finds your own memory and never the other user's", async () => {
  const mine = JSON.parse(text(await call(aliceToken, "search_memories", { query: "pets", limit: 20 }))).memories as Memory[];
  assert.ok(mine.some((m) => m.content.includes("Miso") && m.content.includes(tag)), "Alice should find Miso");
  assert.ok(!mine.some((m) => m.content.includes("Biscuit")), "Alice should not see Biscuit");
  const his = JSON.parse(text(await call(bobToken, "search_memories", { query: "pets", limit: 20 }))).memories as Memory[];
  assert.ok(his.some((m) => m.content.includes("Biscuit") && m.content.includes(tag)), "Bob should find Biscuit");
  assert.ok(!his.some((m) => m.content.includes("Miso")), "Bob should not see Miso");
});

await check("forgetting someone else's memory fails and leaves it alone", async () => {
  const reply = await call(aliceToken, "forget_memory", { id: bobMemory });
  assert.equal(reply.body.result.isError, true);
  assert.match(text(reply), /No memory/);
  assert.ok((await listMemories(bob.client)).some((m) => m.id === bobMemory), "Bob's memory should still be there");
});

await check("turns away requests without a valid user token", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const headers = { "content-type": "application/json" };
  assert.equal((await fetch(url, { method: "POST", headers, body })).status, 401, "no header");
  const tampered = `${aliceToken.slice(0, -4)}AAAA`;
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, authorization: `Bearer ${tampered}` }, body })).status, 401, "tampered token");
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, authorization: `Bearer ${settings.publishableKey}` }, body })).status, 401, "publishable key");
});

await check("row-level security hides and blocks other users' rows", async () => {
  assert.ok(!(await listMemories(alice.client)).some((m) => m.id === bobMemory), "Alice should not list Bob's memory");
  const { error } = await alice.client.from("memories").insert({ user_id: bob.user.id, content: "Planted by Alice", embedding: JSON.stringify(new Array(384).fill(0)) });
  assert.match(error?.message ?? "", /row-level security/);
});

await check("cleans up", async () => {
  for (const { token, id } of stored) {
    const reply = await call(token, "forget_memory", { id });
    assert.notEqual(reply.body.result.isError, true);
  }
});

process.exit(failed ? 1 : 0);
