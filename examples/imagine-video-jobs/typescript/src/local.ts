import { spawnSync } from "node:child_process";

export type SupabaseSettings = { url: string; publishableKey: string; secretKey?: string };

// For a hosted project, set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (and SUPABASE_SECRET_KEY
// for the scripts that need it). Otherwise ask the Supabase CLI about the local stack.
export function supabaseSettings(): SupabaseSettings {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    return { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, secretKey: SUPABASE_SECRET_KEY };
  }
  const status = spawnSync("supabase", ["status", "-o", "json"], { encoding: "utf8" });
  try {
    // Newer CLIs add a few keys of their own, so read only the ones we need.
    const { API_URL, PUBLISHABLE_KEY, SECRET_KEY } = JSON.parse(status.stdout.slice(status.stdout.indexOf("{")));
    if (!API_URL || !PUBLISHABLE_KEY) throw new Error("missing keys");
    return { url: API_URL, publishableKey: PUBLISHABLE_KEY, secretKey: SECRET_KEY };
  } catch {
    console.error("Local Supabase isn't running. Start it with npm run supabase:fake (no key needed) or npm run supabase:start.");
    process.exit(1);
  }
}
