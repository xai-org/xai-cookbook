// End-to-end tests against the local stack in FAKE mode: no SpaceXSI API key, no spend.
// Start it first with npm run supabase:fake.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { type RealtimeChannel, type SupabaseClient, createClient } from "@supabase/supabase-js";
import { supabaseSettings } from "./local.ts";

const { url, publishableKey, secretKey } = supabaseSettings();
assert.ok(secretKey, "The tests need SUPABASE_SECRET_KEY, or a local stack");
const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const FAKE_CLIP = await readFile(new URL("../supabase/functions/worker/fake-video.mp4", import.meta.url));
const SAMPLE_IMAGE = await readFile(new URL("../sample-cat.jpg", import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = { id: string; status: string; progress: number; video_path: string | null; cost_usd: number | null; estimated_usd: number; billable_usd: number; request_id: string | null; error: string | null };
type Tick = { mode: string; started: string[]; checked: string[] };

// Runs one worker pass now, instead of waiting for pg_cron.
const tick = async (): Promise<Tick> => {
  const res = await fetch(`${url}/functions/v1/worker?wait=1`, { method: "POST", headers: { apikey: secretKey } });
  assert.equal(res.status, 200, `The worker answered ${res.status}: ${await res.clone().text()}`);
  return res.json();
};

async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

type User = { id: string; db: SupabaseClient };
const users: User[] = [];
async function newUser(name: string): Promise<User> {
  const email = `${name}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  assert.ifError(error);
  const db = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password: "password123" });
  assert.ifError(signIn.error);
  const user = { id: data.user!.id, db };
  users.push(user);
  return user;
}

const rowOf = async (user: User, id: string) => (await user.db.from("generations").select("*").eq("id", id).single()).data as Row;
async function queue(user: User, fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await user.db.from("generations").insert({ duration_seconds: 1, ...fields }).select("id").single();
  assert.ifError(error);
  return data!.id;
}
const finished = (user: User, id: string, ms = 90_000) =>
  until(`job ${id} to finish`, async () => {
    const row = await rowOf(user, id);
    return ["done", "failed"].includes(row.status) && row;
  }, ms);

function listen(user: User): Promise<{ events: Row[]; channel: RealtimeChannel }> {
  const events: Row[] = [];
  return new Promise((resolve, reject) => {
    const channel = user.db.channel(`test:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "generations" }, ({ new: row }) => events.push(row as Row))
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // The first subscription on a fresh stack needs a few seconds before it receives events.
          await sleep(3000);
          resolve({ events, channel });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`Realtime: ${status}`));
      });
  });
}

describe("video jobs", () => {
  let alice: User, bob: User;
  let aliceJob = "", aliceVideo = "";
  let aliceEvents: Row[] = [], bobEvents: Row[] = [];

  before(async () => {
    assert.equal((await tick()).mode, "fake", "The stack isn't in fake mode. Run npm run supabase:fake first.");
    alice = await newUser("alice");
    bob = await newUser("bob");
  });

  after(async () => {
    for (const user of users) {
      for (const bucket of ["sources", "videos"]) {
        const { data } = await admin.storage.from(bucket).list(user.id);
        if (data?.length) await admin.storage.from(bucket).remove(data.map((file) => `${user.id}/${file.name}`));
      }
      await admin.auth.admin.deleteUser(user.id); // cascades to their jobs and budget
    }
  });

  it("finishes a queued job on the cron alone, with live updates", async () => {
    const [a, b] = await Promise.all([listen(alice), listen(bob)]);
    aliceEvents = a.events;
    bobEvents = b.events;
    // No tick() here: this proves pg_cron -> pg_net -> worker, including configure_worker().
    aliceJob = await queue(alice, { prompt: "A paper boat drifting down a rain-soaked street" });
    const row = await finished(alice, aliceJob, 60_000);
    assert.equal(row.status, "done", row.error ?? "");
    await sleep(1000);
    const mine = aliceEvents.filter((event) => event.id === aliceJob);
    const statuses = mine.map((event) => event.status);
    assert.ok(statuses.includes("running") && statuses.at(-1) === "done", `events: ${statuses}`);
    assert.ok(mine.some((event) => event.status === "running" && event.progress > 0), "no progress update arrived");
    assert.ok(row.video_path);
    aliceVideo = row.video_path;
    assert.equal(Number(row.cost_usd), 0.1);
    assert.equal(Number(row.estimated_usd), 0.1);
    await a.channel.unsubscribe();
    await b.channel.unsubscribe();
  });

  it("keeps the video private", async () => {
    const { data, error } = await alice.db.storage.from("videos").createSignedUrl(aliceVideo, 60);
    assert.ifError(error);
    const res = await fetch(data!.signedUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal((await res.arrayBuffer()).byteLength, FAKE_CLIP.byteLength);

    assert.ok((await bob.db.storage.from("videos").createSignedUrl(aliceVideo, 60)).error, "Bob got a signed URL");
    const seen = await bob.db.from("generations").select("id");
    assert.ok(!seen.data?.some((row) => row.id === aliceJob));
    assert.equal(bobEvents.filter((event) => event.id === aliceJob).length, 0, "Bob received Alice's events");
  });

  it("never starts a job twice when worker runs overlap", async () => {
    const carol = await newUser("carol");
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await queue(carol, { prompt: `Overlap test ${i}` }));
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => tick()));
    const started = runs.flatMap((run) => run.started);
    assert.equal(new Set(started).size, started.length, "a job was claimed by two runs");
    const rows = await until("all four to be running", async () => {
      const found = (await carol.db.from("generations").select("*").in("id", ids)).data as Row[];
      return found.every((row) => ["running", "done"].includes(row.status)) && found;
    });
    assert.equal(new Set(rows.map((row) => row.request_id)).size, 4);
    assert.ok(rows.every((row) => row.request_id && row.status !== "failed"));
  });

  it("rejects a job past the spend cap, and gives the money back when a job fails", async () => {
    const dave = await newUser("dave");
    // The signup trigger made the budget row.
    assert.ifError((await admin.from("budgets").update({ cap_usd: 0.15 }).eq("user_id", dave.id)).error);
    await queue(dave, { prompt: "First one fits" });
    const second = await dave.db.from("generations").insert({ prompt: "Second one doesn't", duration_seconds: 1 });
    assert.equal(second.error?.code, "P0001");
    assert.match(second.error?.message ?? "", /Spend cap reached/);

    const erin = await newUser("erin");
    assert.ifError((await admin.from("budgets").update({ cap_usd: 0.15 }).eq("user_id", erin.id)).error);
    const failing = await queue(erin, { prompt: "[fail] this one fails" });
    const blocked = await erin.db.from("generations").insert({ prompt: "Still reserved", duration_seconds: 1 });
    assert.equal(blocked.error?.code, "P0001");
    const row = await finished(erin, failing);
    assert.equal(row.status, "failed");
    assert.equal(Number(row.billable_usd), 0);
    await queue(erin, { prompt: "Fits again" });
  });

  it("stops users from setting the worker's columns or using other people's images", async () => {
    for (const fields of [{ status: "done" }, { cost_usd: 0 }, { user_id: bob.id }]) {
      const { error } = await alice.db.from("generations").insert({ prompt: "x", ...fields });
      assert.equal(error?.code, "42501", JSON.stringify(fields));
    }
    for (const source_path of [`${bob.id}/cat.jpg`, `${alice.id}/../${bob.id}/cat.jpg`, `${alice.id}/..`]) {
      const wrongFolder = await alice.db.from("generations").insert({ prompt: "x", source_path });
      assert.equal(wrongFolder.error?.code, "42501", source_path);
    }
    const upload = await alice.db.storage.from("sources").upload(`${bob.id}/x.jpg`, SAMPLE_IMAGE, { contentType: "image/jpeg" });
    assert.ok(upload.error, "Alice wrote into Bob's folder");
    const claim = await alice.db.rpc("claim_queued_generations", { max_rows: 1 });
    assert.ok(claim.error, "Alice called a worker function");
  });

  it("marks a failed render as failed, with its reason", async () => {
    const id = await queue(alice, { prompt: "[fail] on purpose" });
    const row = await finished(alice, id);
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /Fake failure/);
  });

  it("carries a source image from Storage to the worker", async () => {
    const source_path = `${alice.id}/cat.jpg`;
    const upload = await alice.db.storage.from("sources").upload(source_path, SAMPLE_IMAGE, { contentType: "image/jpeg", upsert: true });
    assert.ifError(upload.error);
    const withImage = await queue(alice, { prompt: "The cat turns its head", source_path });
    assert.equal((await finished(alice, withImage)).status, "done");

    const missing = await queue(alice, { prompt: "No such image", source_path: `${alice.id}/missing.jpg` });
    const row = await finished(alice, missing);
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /Couldn't read the source image/);
  });
});
