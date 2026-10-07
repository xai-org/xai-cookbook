import { writeFile } from "node:fs/promises";
import { SpaceXAI } from "@xai-official/sdk";

// Writes sample-reviews.csv: about 1,000 made-up app store reviews of a budgeting app over 12 weeks. The script
// decides what each review is about, how many there are each week, and their ratings, so the themes and trends
// are known. Grok writes the text.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

const APP = "Pennywell, a budgeting app that connects to your bank accounts";
const FIRST_MONDAY = Date.parse("2026-07-13");
const DAY_MS = 86_400_000;
// The release each review was written on, by the date it came out.
const VERSIONS = [
  ["2026-07-13", "4.8.2"],
  ["2026-08-10", "4.9.0"],
  ["2026-09-07", "5.0.0"],
  ["2026-09-21", "5.0.1"],
];

type Group = { about: string; stars: number[]; weekly: number[]; platform?: string };

// Bank sync breaks after a change in week 10, the price goes up in week 7, 5.0 brings a new planner and a crash
// in week 9, and the login code problem is fixed in week 5.
const GROUPS: Group[] = [
  { about: "bank sync is broken: transactions stopped importing, accounts keep disconnecting, or reconnecting a bank fails or loops back to the login screen", stars: [1, 1, 2], weekly: [5, 4, 5, 4, 5, 5, 6, 8, 12, 24, 36, 46] },
  { about: "Premium went up from $4.99 to $7.99 a month. Some are cancelling, some say it's no longer worth it, and some will stay but are annoyed", stars: [1, 2, 2, 3], weekly: [0, 0, 0, 0, 0, 0, 16, 20, 15, 13, 11, 10] },
  { about: "since the 5.0 update the app crashes on launch, or when they open the planner, on their Android phone", stars: [1, 1, 2], weekly: [0, 0, 0, 0, 0, 0, 0, 0, 24, 28, 15, 10], platform: "Android" },
  { about: "the verification code to log in never arrives by text or email, so they're locked out of their account", stars: [1, 1, 2], weekly: [12, 13, 14, 12, 7, 4, 3, 2, 2, 1, 2, 1] },
  { about: "they love the new budget planner from the 5.0 update: planning the month ahead, moving money between categories, and seeing what's left", stars: [4, 5, 5], weekly: [0, 0, 0, 0, 0, 0, 0, 0, 18, 20, 17, 15] },
  { about: "the app is easy to use and has helped them save money, stick to a budget, or pay off debt", stars: [4, 5, 5], weekly: [13, 12, 14, 13, 12, 13, 12, 13, 11, 11, 12, 10] },
  { about: "customer support is slow or unhelpful: days without an answer, canned replies, and no chat or phone option", stars: [1, 2], weekly: [8, 7, 8, 9, 8, 7, 8, 8, 10, 12, 13, 14] },
  { about: "they wish they could share a budget with a partner or family, like a household budget with two logins", stars: [3, 4, 4, 5], weekly: [7, 8, 6, 7, 8, 6, 8, 7, 6, 8, 7, 8] },
  { about: "they want a desktop or web version, or a way to export their transactions to CSV or a spreadsheet", stars: [3, 3, 4], weekly: [5, 6, 6, 5, 5, 6, 5, 6, 5, 6, 5, 6] },
  { about: "nothing specific: short, vague reviews like 'ok', 'does the job', or 'meh', plus a few about something only one person would bring up, like the app icon, a font, or a notification sound", stars: [2, 3, 4, 5], weekly: [7, 6, 7, 6, 7, 6, 7, 6, 7, 6, 7, 6] },
  { about: "bank sync broke and support hasn't helped: no answer for days, or a canned reply", stars: [1], weekly: [0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 6] },
  { about: "they now pay $7.99 a month for an app that crashes on launch on their Android phone since the 5.0 update", stars: [1], weekly: [0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 3, 2], platform: "Android" },
  { about: "they like the new budget planner in 5.0, but Premium going up to $7.99 a month stings", stars: [3, 4], weekly: [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 2, 2] },
];

// A seeded random number generator, so the dates, ratings, and platforms come out the same every time.
let seed = 42;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

// A long response now and then fails partway with "Internal error during token generation", which the SDK
// doesn't retry once output has started, so each group gets a few tries.
async function writeReviews(group: Group): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await askForReviews(group);
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`Trying again after an error: ${error instanceof Error ? error.message : error}`);
    }
  }
}

async function askForReviews(group: Group): Promise<string[]> {
  const count = group.weekly.reduce((sum, n) => sum + n, 0);
  const response = await client.responses.create({
    model: "grok-4.7",
    reasoning: { effort: "low" },
    input: `Write ${count} reviews of ${APP}, as they'd appear on its app store page. Each one is by a different person, and every one of them is about this: ${group.about}.

Make them read like real reviews. Vary the length: some are a few words, most are one to three sentences, and a few are a short paragraph. Vary the mood within ${group.stars.join(" or ")} stars, from angry or tired to polite, sarcastic, or hopeful, and the details, like which bank, what they were trying to do, or how long they've used the app. Start them in different ways. Some are all lowercase or have a typo, and a few use an emoji. Don't mention star ratings, dates, or months.`,
    text: {
      format: {
        type: "json_schema",
        name: "reviews",
        schema: {
          type: "object",
          properties: {
            reviews: {
              type: "array",
              minItems: count,
              maxItems: count,
              items: {
                type: "object",
                // Asked to vary the tone, Grok sometimes labels it in the text, as in "Polite request: please fix
                // sync". A field of its own for the style keeps the label out of the review.
                properties: {
                  style: { type: "string", description: "How this person writes, in a few words" },
                  text: { type: "string", description: "The review, exactly as they typed it" },
                },
                required: ["style", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["reviews"],
          additionalProperties: false,
        },
      },
    },
  });
  const { reviews } = response.toJson() as { reviews: Array<{ style: string; text: string }> };
  console.log(`${reviews.length} reviews about ${group.about.slice(0, 60)}...`);
  return reviews.map((review) => review.text.replace(/\s+/g, " ").trim());
}

const texts = await Promise.all(GROUPS.map(writeReviews));
const rows = GROUPS.flatMap((group, index) => {
  const reviews = texts[index];
  let next = 0;
  return group.weekly.flatMap((count, week) =>
    Array.from({ length: count }, () => {
      const date = new Date(FIRST_MONDAY + (week * 7 + Math.floor(random() * 7)) * DAY_MS).toISOString().slice(0, 10);
      return {
        date,
        rating: pick(group.stars),
        platform: group.platform ?? (random() < 0.55 ? "iOS" : "Android"),
        version: VERSIONS.findLast(([released]) => released <= date)![1],
        text: reviews[next++ % reviews.length],
        order: random(),
      };
    }),
  );
});
rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

const csv = rows.map((row, index) => [index + 1, row.date, row.rating, row.platform, row.version, `"${row.text.replace(/"/g, '""')}"`].join(","));
await writeFile(new URL("../sample-reviews.csv", import.meta.url), `id,date,rating,platform,version,text\n${csv.join("\n")}\n`);
console.log(`Wrote ${rows.length} reviews to sample-reviews.csv`);
