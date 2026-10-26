import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { styleText } from "node:util";
import { type Attachment, ask, attach } from "./chat.ts";
import { fileMode, supabaseEnv } from "./config.ts";
import { seed } from "./seed.ts";
import { anon, deleteFile, downloadFile, listFiles, listReads, recordRead, signFileUrl, signIn, tokenClaims, uploadFile, userClient } from "./storage.ts";

const live = process.argv.includes("--live");
let failed = 0;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`${styleText("green", "ok")}    ${name}`);
  } catch (error) {
    failed++;
    console.log(`${styleText("red", "FAIL")}  ${name}\n      ${error instanceof Error ? error.message : error}`);
  }
}
function skip(name: string, why: string): void {
  console.log(`${styleText("yellow", "skip")}  ${name} (${why})`);
}

const env = supabaseEnv();
const users = await seed(() => {});
const alice = await signIn(users.alice.email, users.alice.password);
const bob = await signIn(users.bob.email, users.bob.password);
const aliceDb = userClient(alice.token);
const bobDb = userClient(bob.token);
const alicePath = users.alice.path;
const bobPath = users.bob.path;

// Section 1: row-level security. No SpaceXSI API key needed.
await step("Alice lists her own file", async () => {
  assert.ok((await listFiles(aliceDb, alice.userId)).some((file) => file.name === users.alice.sample));
});
await step("Bob can't list Alice's folder, and sees only his own file", async () => {
  assert.deepEqual(await listFiles(bobDb, alice.userId), []);
  assert.deepEqual((await listFiles(bobDb, bob.userId)).map((file) => file.name), [users.bob.sample]);
});
await step("Bob can't sign a URL for Alice's file", async () => {
  await assert.rejects(signFileUrl(bobDb, alicePath, 60), /not found/i);
});
await step("Bob can't download Alice's file", async () => {
  await assert.rejects(downloadFile(bobDb, alicePath));
});
await step("Bob can't upload into Alice's folder", async () => {
  await assert.rejects(uploadFile(bobDb, alice.userId, "planted.txt", new Blob(["hi"], { type: "text/plain" })), /row-level security/i);
});
await step("A signed-out client sees no files and can't sign one", async () => {
  const db = anon();
  assert.deepEqual(await listFiles(db, alice.userId), []);
  await assert.rejects(signFileUrl(db, alicePath, 60));
});
await step("Each user's reads are theirs alone", async () => {
  await recordRead(aliceDb, { object_name: alicePath, mode: "signed_url", url_expires_at: null, question: "check" });
  assert.ok((await listReads(aliceDb)).length >= 1);
  assert.equal((await listReads(bobDb)).filter((read) => read.object_name === alicePath).length, 0);
});
await step("Bob can't record a read of Alice's file, or as Alice", async () => {
  await assert.rejects(recordRead(bobDb, { object_name: alicePath, mode: "signed_url", url_expires_at: null, question: "x" }));
  const { error } = await bobDb.from("file_reads").insert({ user_id: alice.userId, object_name: alicePath, mode: "upload", question: "x" });
  assert.ok(error, "inserting as Alice should fail");
});
await step("Reads can't be changed or deleted", async () => {
  const update = await aliceDb.from("file_reads").update({ question: "changed" }).eq("user_id", alice.userId);
  assert.match(update.error?.message ?? "", /permission denied/i);
  const remove = await aliceDb.from("file_reads").delete().eq("user_id", alice.userId);
  assert.match(remove.error?.message ?? "", /permission denied/i);
});


// Section 2: what a signed URL is bound to.
await step("A signed URL downloads the file", async () => {
  const { url } = await signFileUrl(aliceDb, alicePath, 5);
  const direct = await fetch(url);
  assert.equal(direct.status, 200);
  assert.equal(Buffer.from(await direct.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
});
await step("A token for one object doesn't open another", async () => {
  const { url } = await signFileUrl(aliceDb, alicePath, 5);
  const other = url.replace(encodeURI(alicePath), encodeURI(bobPath));
  assert.notEqual(other, url);
  assert.equal((await fetch(other)).status, 400);
});
await step("A URL stops working when it expires", async () => {
  const { url } = await signFileUrl(aliceDb, alicePath, 2);
  assert.equal((await fetch(url)).status, 200);
  await sleep(4000);
  const response = await fetch(url);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /InvalidJWT|ExpiredToken|exp/i);
});
await step("The token holds the object path and an expiry, and no host", async () => {
  const { url, claims } = await signFileUrl(aliceDb, alicePath, 60);
  assert.equal(claims.url, `files/${alicePath}`);
  assert.equal(typeof claims.exp, "number");
  assert.ok(!JSON.stringify(tokenClaims(url)).includes(new URL(env.url).hostname));
});

// Section 3: Grok. Costs a few cents. SpaceXSI can't reach a local stack, so there only the upload checks run.
const mode = fileMode(env.url);
if (live && !process.env.XAI_API_KEY) skip("Live checks", "XAI_API_KEY isn't set");
else if (!live) skip("Live checks", "run with --live");
else {
  let total = 0;
  const question = "How much is the monthly pet fee?";
  if (mode === "signed_url") {
    await step("Signed URL: Grok fetches the file and answers from it", async () => {
      const attachment = await attach(aliceDb, alicePath, "signed_url", { ttl: 120 });
      const answer = await ask({ question, attachment });
      total += answer.cost;
      console.log(`      answer: ${answer.text}`);
      console.log(`      searches: ${JSON.stringify(answer.searches)}, document_search_calls: ${answer.documentSearches}, cost $${answer.cost.toFixed(4)}`);
      assert.match(answer.text, /45/);
      assert.ok(answer.documentSearches >= 1);
    });

    await step("Expired URL: Grok can't read the file, and says so", async () => {
      const attachment = await attach(aliceDb, alicePath, "signed_url", { ttl: 15 });
      await sleep(17_000);
      let text = "";
      try {
        text = (await ask({ question, attachment })).text;
        console.log(`      Grok said: ${text}`);
      } catch (error) {
        console.log(`      the request failed: ${error instanceof Error ? error.message : error}`);
      }
      assert.doesNotMatch(text, /45/);
    });
  } else {
    skip("Signed URL live checks", "SpaceXSI can't reach a local stack, so they need a hosted project");
  }

  await step("Upload fallback: the copy answers, then it's deleted", async () => {
    const attachment: Attachment = await attach(aliceDb, alicePath, "upload", { ttl: 120 });
    try {
      const answer = await ask({ question, attachment });
      total += answer.cost;
      console.log(`      answer: ${answer.text}`);
      assert.match(answer.text, /45/);
    } finally {
      await attachment.cleanup();
    }
    const { SpaceXAI } = await import("@xai-official/sdk");
    await assert.rejects(new SpaceXAI().files.get(attachment.fileId!));
  });
  console.log(`Live checks cost $${total.toFixed(4)}`);
}

await deleteFile(aliceDb, `${alice.userId}/planted.txt`).catch(() => {});
console.log(failed ? styleText("red", `${failed} failed`) : styleText("green", "All checks passed"));
process.exit(failed ? 1 : 0);
