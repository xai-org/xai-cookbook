import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { supabaseSettings } from "./local.ts";

const fake = process.argv[2] === "fake";
if (!fake && !process.env.XAI_API_KEY) {
  console.error("XAI_API_KEY is missing. Put it in .env at the root of the repo, or run npm run supabase:fake to try everything without a key.");
  process.exit(1);
}

// The worker reads its secrets when the stack starts, so switching modes needs a restart.
// Stopping keeps the data.
const env = { ...process.env, FAKE_XAI: fake ? "1" : "0" };
for (const args of [["stop"], ["start"]]) {
  const result = spawnSync("supabase", args, { env, stdio: "inherit" });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    console.error("The Supabase CLI isn't installed. See https://supabase.com/docs/guides/local-development/cli/getting-started");
    process.exit(1);
  }
  if (result.status !== 0 && args[0] === "start") process.exit(result.status ?? 1);
}

// Tell pg_cron where the worker lives and which key to send. kong:8000 is the API gateway as
// the database container sees it.
const { url, publishableKey, secretKey } = supabaseSettings();
const admin = createClient(url, secretKey ?? publishableKey, { auth: { persistSession: false } });
let last = "";
for (let attempt = 0; attempt < 10; attempt++) {
  // PostgREST may still be loading its schema cache right after the stack starts.
  const { error } = await admin.rpc("configure_worker", { worker_url: "http://kong:8000/functions/v1/worker", worker_key: secretKey });
  if (!error) { last = ""; break; }
  last = error.message;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (last) {
  console.error(`Couldn't configure the worker: ${last}`);
  process.exit(1);
}

console.log(fake ? "\nFAKE mode: simulates Grok Imagine, nothing is billed." : "\nReal mode: videos are billed to your SpaceXSI API key.");
console.log("Next: npm run web");
