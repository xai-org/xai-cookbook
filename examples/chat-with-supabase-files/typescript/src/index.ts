import { styleText } from "node:util";
import { ask, attach } from "./chat.ts";
import { SAMPLE_QUESTIONS, SEED_USERS, TTL, errorMessage, fileMode, isLocal, supabaseEnv } from "./config.ts";
import { listFiles, recordRead, signIn, userClient } from "./storage.ts";

// npm start -- [--user alice|bob] [--file name] [--ttl 120] [--upload] "question"
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const forceUpload = args.includes("--upload");
const userKey = option("--user") ?? "alice";
const fileName = option("--file");
const ttl = Math.min(TTL.max, Math.max(TTL.min, Number(option("--ttl")) || TTL.default));
const user = SEED_USERS.find((candidate) => candidate.key === userKey);
if (!user) throw new Error(`--user is alice or bob, not ${userKey}`);
const question = args.filter((arg) => arg !== "--upload").join(" ") || SAMPLE_QUESTIONS[user.sample][0];

try {
  const env = supabaseEnv();
  const session = await signIn(user.email, user.password);
  const db = userClient(session.token);
  const files = await listFiles(db, session.userId);
  const file = fileName ?? files[0]?.name;
  if (!file) throw new Error("No files yet. Run npm run seed first.");

  // SpaceXSI can't reach a local stack, so there the file goes to the Files API instead of by URL.
  const mode = forceUpload ? "upload" : fileMode(env.url);
  if (mode === "upload" && isLocal(env.url)) console.log(styleText("dim", "Local stack: copying the file to the Files API, since SpaceXSI can't reach your machine"));

  console.log(styleText("bold", `${user.email} asks about ${file}`));
  console.log(question);
  const attachment = await attach(db, `${session.userId}/${file}`, mode, { ttl });
  const started = Date.now();
  try {
    await recordRead(db, { object_name: attachment.object, mode, url_expires_at: attachment.expiresAt ?? null, question });
    // The token stays out of the terminal: until it expires, whoever has the full URL can download the file.
    if (attachment.url) console.log(styleText("dim", `Signed URL for ${attachment.object}, expires ${attachment.expiresAt}`));
    if (attachment.fileId) console.log(styleText("dim", `Uploaded to the Files API as ${attachment.fileId}`));
    console.log();
    const answer = await ask({
      question,
      attachment,
      on: {
        searched: (search) => console.log(styleText("dim", `searched with ${search.tool}${search.queries.length ? `: ${search.queries.join(", ")}` : ""}`)),
        text: (text) => process.stdout.write(text),
      },
    });
    console.log(`\n\n${answer.documentSearches} searches, ${answer.inputTokens} in, ${answer.outputTokens} out, $${answer.cost.toFixed(4)}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await attachment.cleanup();
    if (attachment.fileId) console.log(`Deleted ${attachment.fileId} from the Files API`);
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
