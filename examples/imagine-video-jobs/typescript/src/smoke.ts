// Real mode: queues one or two 1-second 480p videos and waits for them. This is billed to your key.
// Start the stack first with npm run supabase:start. Add --image to also animate the sample cat.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { supabaseSettings } from "./local.ts";

const { url, publishableKey, secretKey } = supabaseSettings();
if (!secretKey) throw new Error("This script needs SUPABASE_SECRET_KEY, or a local stack.");
const tick = async () => {
  const res = await fetch(`${url}/functions/v1/worker?wait=1`, { method: "POST", headers: { apikey: secretKey } });
  return res.json() as Promise<{ mode: string }>;
};
if ((await tick()).mode !== "real") {
  console.error("The worker is in fake mode. Run npm run supabase:start first.");
  process.exit(1);
}

// The same account every time, so the videos also show up when you sign in to the page.
const db = createClient(url, publishableKey, { auth: { persistSession: false } });
const credentials = { email: "smoke@example.com", password: "password123" };
let { error } = await db.auth.signInWithPassword(credentials);
if (error) ({ error } = await db.auth.signUp(credentials));
if (error) throw error;
const { data: session } = await db.auth.getSession();
const userId = session.session!.user.id;

const queued: string[] = [];
async function queue(prompt: string, source_path?: string) {
  const { data, error } = await db.from("generations").insert({ prompt, source_path, duration_seconds: 1, resolution: "480p" }).select("id").single();
  if (error) throw error;
  queued.push(data.id);
  console.log(`Queued "${prompt}"`);
}

await queue("A paper boat drifting down a rain-soaked street");
if (process.argv.includes("--image")) {
  const source_path = `${userId}/cat-${Date.now()}.jpg`;
  const up = await db.storage.from("sources").upload(source_path, await readFile(new URL("../sample-cat.jpg", import.meta.url)), { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  await queue("The cat turns its head and blinks", source_path);
}

const startedAt = Date.now();
let total = 0;
const finishedIds = new Set<string>();
while (finishedIds.size < queued.length && Date.now() - startedAt < 6 * 60_000) {
  await tick(); // the cron does this every 10 seconds anyway; this just makes the first start quicker
  const { data } = await db.from("generations").select("*").in("id", queued);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  for (const row of data ?? []) {
    console.log(`[${seconds}s] ${row.prompt.slice(0, 40)}: ${row.status} ${row.progress}%${row.error ? ` (${row.error})` : ""}`);
    if (!["done", "failed"].includes(row.status) || finishedIds.has(row.id)) continue;
    finishedIds.add(row.id);
    total += Number(row.billable_usd);
    if (row.status === "done") {
      const { data: signed } = await db.storage.from("videos").createSignedUrl(row.video_path, 60);
      const bytes = (await (await fetch(signed!.signedUrl)).arrayBuffer()).byteLength;
      console.log(`  done: ${bytes} bytes, cost $${row.cost_usd} (estimate was $${row.estimated_usd})`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.log(`Total: $${total.toFixed(4)}`);
if (finishedIds.size < queued.length) process.exit(1);
