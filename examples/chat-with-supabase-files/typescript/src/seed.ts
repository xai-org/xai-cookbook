import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { OUTPUT_DIR, SAMPLES_DIR, SEED_USERS, supabaseEnv } from "./config.ts";
import { listFiles, signIn, uploadFile, userClient } from "./storage.ts";

export type SeededUsers = Record<string, { id: string; email: string; password: string; sample: string; path: string }>;

// Creates the two demo users and puts each one's sample file in their own folder. It's the only code that uses the
// secret key, because creating a confirmed user takes the admin API. It can run again and only fills in what's missing.
export async function seed(log: (line: string) => void = console.log): Promise<SeededUsers> {
  const env = supabaseEnv();
  if (!env.secretKey) throw new Error("Seeding creates users, which takes the secret key. Set SUPABASE_SECRET_KEY, or run against the local project.");
  const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
  const users: SeededUsers = {};

  for (const user of SEED_USERS) {
    const created = await admin.createUser({ email: user.email, password: user.password, email_confirm: true });
    if (created.error) {
      if (!/already|registered|exists/i.test(created.error.message)) throw new Error(`Creating ${user.email}: ${created.error.message}`);
      const existing = (await admin.listUsers({ perPage: 200 })).data.users.find((candidate) => candidate.email === user.email);
      if (!existing) throw new Error(`${user.email} exists but couldn't be found`);
      await admin.updateUserById(existing.id, { password: user.password, email_confirm: true });
      log(`${user.email}: already there, password reset`);
    } else {
      log(`${user.email}: created`);
    }

    // The sample goes in with the user's own token, the same way the app uploads, so their policies are what let it in.
    const session = await signIn(user.email, user.password);
    const db = userClient(session.token);
    const path = `${session.userId}/${user.sample}`;
    if ((await listFiles(db, session.userId)).some((file) => file.name === user.sample)) {
      log(`${user.email}: ${user.sample} is already uploaded`);
    } else {
      const bytes = await readFile(join(SAMPLES_DIR, user.folder, user.sample));
      await uploadFile(db, session.userId, user.sample, new Blob([bytes], { type: "application/pdf" }));
      log(`${user.email}: uploaded ${user.sample}`);
    }
    users[user.key] = { id: session.userId, email: user.email, password: user.password, sample: user.sample, path };
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, "users.json"), JSON.stringify(users, null, 2));
  log("Saved output/users.json");
  return users;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await seed();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
