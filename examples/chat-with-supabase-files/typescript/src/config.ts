import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.PORT ?? 3103);
// FILE_MODE=upload copies the file to the Files API for each answer, even on a hosted project.
export const FORCE_UPLOAD = process.env.FILE_MODE === "upload";
// A signed download from the files bucket: the only URL the app hands out or checks.
export const SIGNED_PATH = /^\/storage\/v1\/object\/sign\/files\/[^?#]+$/;

// Seconds a signed URL works for. The server clamps whatever the page asks for.
export const TTL = { default: 120, min: 15, max: 300, choices: [30, 120, 300] };

export const BUCKET = "files";
export const MAX_BYTES = 50 * 1024 * 1024;
export const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
};

export const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
export const OUTPUT_DIR = fileURLToPath(new URL("../output/", import.meta.url));
export const SAMPLES_DIR = fileURLToPath(new URL("../samples/", import.meta.url));

export const SEED_USERS = [
  { name: "Alice", key: "alice", email: "alice@example.com", password: "alice-demo-password", sample: "apartment-lease.pdf", folder: "alice" },
  { name: "Bob", key: "bob", email: "bob@example.com", password: "bob-demo-password", sample: "contents-insurance.pdf", folder: "bob" },
];

export const SAMPLE_QUESTIONS: Record<string, string[]> = {
  "apartment-lease.pdf": ["How much is the monthly pet fee, and is there a weight limit?", "How much notice do I give before moving out?", "Can I sublet the apartment?"],
  "contents-insurance.pdf": ["Is my bike covered if it's stolen from my porch?", "What's the deductible on a burst pipe claim?", "How long do I have to file a claim?"],
};

export type SupabaseEnv = { url: string; publishableKey: string; secretKey?: string };
let cached: SupabaseEnv | undefined;

// Where the Supabase project is. Environment variables win, so the same code runs against a hosted
// project. Without them it asks the CLI about the local one, which `supabase start` runs in Docker.
export function supabaseEnv(): SupabaseEnv {
  if (cached) return cached;
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    return (cached = { url: SUPABASE_URL.replace(/\/$/, ""), publishableKey: SUPABASE_PUBLISHABLE_KEY, secretKey: SUPABASE_SECRET_KEY });
  }
  try {
    const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: PROJECT_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Record<string, string>;
    const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    if (!status.API_URL || !publishableKey) throw new Error("no keys");
    return (cached = {
      url: status.API_URL,
      publishableKey,
      secretKey: SUPABASE_SECRET_KEY ?? status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
    });
  } catch {
    throw new Error(
      "Couldn't reach the local Supabase project. Run `supabase start` in examples/chat-with-supabase-files/typescript, or set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
}

export function isLocal(url: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"].includes(new URL(url).hostname);
}

// How Grok gets the file. SpaceXSI fetches a file_url from its own servers, so it can't reach a local stack.
// There the app copies the file to the Files API instead. A hosted project can be reached from the internet, so it gets the URL.
export function fileMode(url: string): "signed_url" | "upload" {
  return FORCE_UPLOAD || isLocal(url) ? "upload" : "signed_url";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
