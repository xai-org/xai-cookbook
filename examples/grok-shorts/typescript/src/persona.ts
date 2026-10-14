import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { SpaceXAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";

const client = new SpaceXAI();
// Personalities made in Personality Studio, one JSON file each.
const DIR = "output/personalities";

// The presenter's personality. `style` tells Grok how to write the lines, and `delivery` tells Grok Imagine how to act
// them out.
export type Persona = { name: string; summary: string; style: string; delivery: string };

export const PERSONALITIES = {
  hype: {
    name: "Hype creator",
    summary: "Everything is the craziest thing they've ever seen, and you need to know right now.",
    style: "Over-the-top excitement. Short, punchy sentences, with lines like \"this is insane\", \"you're not ready\", and \"let's go\". Builds up to the fix like it's a giveaway.",
    delivery: "Very high energy and fast, big hand gestures, leaning into the camera, eyes wide on the reveal.",
  },
  deadpan: {
    name: "Deadpan senior engineer",
    summary: "Has seen every bug twice and is impressed by none of them.",
    style: "Dry, flat, and understated, like a tired senior engineer in code review. Sardonic one-liners and quiet judgment. Never excited: the jokes come from understatement.",
    delivery: "Calm and flat, barely moving, a slow blink or one raised eyebrow, the faintest smirk on the punchline.",
  },
  genz: {
    name: "Gen Z chaos",
    summary: "Chronically online, dramatic about everything, fluent in slang.",
    style: "Gen Z internet slang, like no cap, it's giving, lowkey, bestie, ate, and \"the way that\". Dramatic reactions, self-aware jokes, and rhetorical questions.",
    delivery: "Animated and dramatic, quick head tilts, hands flying, mock outrage, laughing at their own jokes.",
  },
  documentary: {
    name: "Nature documentary",
    summary: "Observes the code like rare wildlife in its natural habitat.",
    style: "A hushed, reverent nature documentary narrator. The bug and the fix are creatures, like \"here we observe the elusive retry limit, separated from its herd\". Gentle sentences with dramatic pauses.",
    delivery: "Soft, hushed, and slow, as if trying not to scare the code away, with calm, wide-eyed wonder.",
  },
  sports: {
    name: "Sports commentator",
    summary: "Calls the pull request like the last minute of a final.",
    style: "Breathless play-by-play. The bug is the other team and the fix is the winning play, with lines like \"and he shoots\", \"what a play\", and \"unbelievable scenes\".",
    delivery: "Excited and fast, rising to a shout on the big play, gesturing like calling a goal.",
  },
  conspiracy: {
    name: "Conspiracy theorist",
    summary: "Connects the dots, and the dots go all the way to the merge function.",
    style: "Escalating suspicion, with lines like \"they don't want you to know\", \"wake up\", and \"follow the data\". The drama is all in the framing: every claim is still true to the diff.",
    delivery: "Intense and hushed, leaning close to the camera, narrowed eyes, a quick glance over one shoulder.",
  },
  teacher: {
    name: "Wholesome teacher",
    summary: "Patient, kind, and makes everyone feel smart.",
    style: "Warm and encouraging, with simple everyday analogies, and lines like \"here's the cool part\" and \"you've got this\". Clear and gentle.",
    delivery: "A warm smile, open hands, nodding along, at a calm and friendly pace.",
  },
  founder: {
    name: "Startup founder",
    summary: "Announces a bug fix like a funding round.",
    style: "Founder-on-LinkedIn energy, with lines like \"thrilled to share\", \"this changes everything\", and \"humbled\", and buzzwords like velocity and leverage. Grandiose about tiny things, for comic effect.",
    delivery: "Polished and confident, fingers steepled, slow nods, a knowing smile as if on stage.",
  },
} satisfies Record<string, Persona>;
export type PersonalityId = keyof typeof PERSONALITIES;

const PERSONA_PROMPT = `You study how an account on X writes, so a script writer can write a short video in the same style. Read the account's recent posts with X search, then describe the style to imitate:
- found: false if X search found no posts from the account, and then leave the other fields empty.
- name: a short label for the style, like "Indie hacker, numbers first".
- summary: one sentence that would let someone recognize the style.
- style: how they write and talk: tone, vocabulary and slang, sentence length and rhythm, humor, recurring phrases, how they open and land a point, and emoji habits. Give a few short example lines in the style about other topics, not quotes.
- delivery: how someone with this style comes across talking to a phone camera: energy, pace, expressions, and gestures.
Describe the style, not the person: no personal details, and nothing hateful or private.`;

const PERSONA_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    summary: { type: "string" },
    style: { type: "string" },
    delivery: { type: "string" },
  },
  required: ["found", "name", "summary", "style", "delivery"],
  additionalProperties: false,
};

// Accepts a handle with or without the @, or a link to the profile.
export function parseHandle(value: string): string | undefined {
  const handle = value.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /^\w{1,15}$/.test(handle) ? handle : undefined;
}

// Has Grok read the account's recent posts with X search, limited to that one account, and describe its style. The
// presenter borrows the style, not the person: the script never uses their name, and the presenter keeps their own face
// and voice.
export async function personaFromX(handle: string, signal?: AbortSignal): Promise<{ persona: Persona; cost: number }> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: PERSONA_PROMPT },
        { role: "user", content: `The account is @${handle}.` },
      ],
      tools: [xSearch({ allowed_x_handles: [handle] })],
      text: { format: { type: "json_schema", name: "persona", schema: PERSONA_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { found, ...persona } = response.toJson() as Persona & { found: boolean };
  if (!found || !persona.style) throw new Error(`Couldn't find any posts from @${handle} to copy.`);
  return { persona, cost: response.usage.cost_usd ?? 0 };
}

// A personality to pick, by its id: a built-in one, or one made in Personality Studio, which is `custom`.
export type Personality = Persona & { id: string; custom: boolean };

export async function listPersonalities(): Promise<Personality[]> {
  const builtIn = Object.entries(PERSONALITIES).map(([id, persona]) => ({ id, ...persona, custom: false }));
  const files = existsSync(DIR) ? (await readdir(DIR)).filter((name) => name.endsWith(".json")) : [];
  const saved = await Promise.all(files.map(async (name) => ({ ...(JSON.parse(await readFile(`${DIR}/${name}`, "utf8")) as Personality), custom: true })));
  return [...builtIn, ...saved.sort((a, b) => a.name.localeCompare(b.name))];
}

export async function findPersonality(id: string): Promise<Persona | undefined> {
  if (id in PERSONALITIES) return PERSONALITIES[id as PersonalityId];
  if (!/^[a-z0-9-]+$/.test(id) || !existsSync(`${DIR}/${id}.json`)) return undefined;
  const { name, summary, style, delivery } = JSON.parse(await readFile(`${DIR}/${id}.json`, "utf8")) as Persona;
  return { name, summary, style, delivery };
}

// Saves a personality under an id made from its name, so saving one of yours again under the same name changes it. A
// name that a built-in personality has gets a number.
export async function savePersonality({ name, summary, style, delivery }: Persona): Promise<string> {
  if (!name.trim() || !style.trim() || !delivery.trim()) throw new Error("Give the personality a name, how they talk, and how they act on camera.");
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "personality";
  let id = base;
  for (let count = 2; id in PERSONALITIES; count++) id = `${base}-${count}`;
  await mkdir(DIR, { recursive: true });
  const persona = { id, name: name.trim(), summary: summary.trim(), style: style.trim(), delivery: delivery.trim() };
  await writeFile(`${DIR}/${id}.json`, JSON.stringify(persona, null, 2));
  return id;
}

const INVENT_PROMPT = `You invent personalities for the presenter of short vertical videos, like creators on TikTok, who explain code changes and talk about anything else. A personality decides how every line is written and how the presenter acts it out on camera. Make it specific, fun to watch, and easy to write a whole video in.
- name: a short label, like "Hype creator" or "Nature documentary".
- summary: one sentence that would let someone recognize it.
- style: how the lines are written: tone, vocabulary and slang, sentence length and rhythm, humor, recurring phrases, and how a point opens and lands, with two or three short example lines about other topics. Lines are said out loud, so no emoji or symbols.
- delivery: how the presenter comes across talking to a phone camera: energy, pace, expressions, and gestures, in a sentence or two.
Base it on a kind of person or a genre, never on a real person by name, and nothing hateful.`;

const PERSONALITY_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" }, summary: { type: "string" }, style: { type: "string" }, delivery: { type: "string" } },
  required: ["name", "summary", "style", "delivery"],
  additionalProperties: false,
};

// Asked only to surprise, Grok tends to come back to the same few ideas, so a surprise starts from a kind of person and an
// energy picked at random, the way Presenter Studio picks an age, a vibe, and a place.
const SPARKS = {
  kind: ["a pirate captain", "a noir detective", "a cooking show host", "a game show host", "a yoga teacher", "a Shakespearean actor", "an eighties radio DJ", "a weather forecaster", "a museum tour guide", "a drill sergeant", "an auctioneer", "a coach at halftime", "a late-night infomercial host", "a medieval herald", "a flight attendant", "a fortune teller", "a lighthouse keeper", "a theme park ride announcer"],
  energy: ["calm", "frantic", "smug", "wholesome", "suspicious", "dramatic", "deadpan", "bubbly", "grumpy", "mysterious"],
};

// Has Grok make up a personality from an idea, or a surprise if there's none.
export async function inventPersonality(idea: string, signal?: AbortSignal): Promise<{ persona: Persona; cost: number }> {
  const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)];
  const start = idea.trim() ? `Start from this idea: ${idea.trim()}` : `Surprise me with a personality like ${pick(SPARKS.kind)}, with a ${pick(SPARKS.energy)} energy.`;
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: INVENT_PROMPT },
        { role: "user", content: start },
      ],
      text: { format: { type: "json_schema", name: "personality", schema: PERSONALITY_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  return { persona: response.toJson() as Persona, cost: response.usage.cost_usd ?? 0 };
}

// What sample lines are for, when there's no topic to try a personality on: two hooks and an ending, from the kinds of
// videos the app makes.
const SAMPLES = [
  "the hook of a video about a fix to how the ky HTTP library merges its retry limit",
  "the hook of a video about why cats knock things off tables",
  "the ending of a video that tells a reviewer a pull request is safe to approve",
];

// Has Grok write a few lines in the personality, to try it before making a video in it: the hook, a beat, and the ending
// of a video about `topic`, or lines for a few kinds of videos.
export async function sampleLines(persona: Persona, topic: string, signal?: AbortSignal): Promise<{ lines: Array<{ about: string; line: string }>; cost: number }> {
  const abouts = topic.trim() ? [`the hook of a video about ${topic.trim()}`, "a beat in the middle of that video", "the ending of that video"] : SAMPLES;
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "system",
          content: `You write lines for the presenter of a short vertical video, in their personality. Each line is said straight to the phone camera, so write it the way it's said out loud, with no emoji or symbols, in at most 25 words.\n\nThe personality is "${persona.name}": ${persona.summary}\nHow they talk: ${persona.style}`,
        },
        { role: "user", content: `Write one line for each of these, in order:\n${abouts.map((about, index) => `${index + 1}. ${about}`).join("\n")}` },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "lines",
          schema: { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false },
        },
      },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { lines } = response.toJson() as { lines: string[] };
  return { lines: abouts.map((about, index) => ({ about, line: lines[index]?.trim() ?? "" })).filter(({ line }) => line), cost: response.usage.cost_usd ?? 0 };
}
