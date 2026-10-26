import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { PermissionDeniedError, SpaceXAI, stripInvalidSpeechTags } from "@xai-official/sdk";
import { listPresenters } from "./presenter.ts";

const client = new SpaceXAI();
const run = promisify(execFile);
// The video model takes the text-to-speech voices by voice_id, except these two, which it answers with "Unknown voice_id".
const NOT_FOR_VIDEO = ["aurora", "liora"];
// A custom voice takes up to 120 seconds of reference audio. Thirty minutes of a call transcribed in 17 seconds.
const MAX_SAMPLE = 100;
const READ_SECONDS = 1800;
// Shorter stretches are mostly "yeah" and "mm-hm" said over someone else, which would put their voice in the sample.
const MIN_STRETCH = 1.5;

export type Voice = { id: string; name: string; gender: string };
// A presenter before they're drawn: everything the studio's form holds.
export type Draft = { name: string; look: string; room: string; voice: string; line: string };
// What the studio takes from a video of the person: frames to pick their likeness from, a sample of their voice, and how
// they look and where they are.
export type FromVideo = { frames: string[]; sample: string; speech: number; look: string; room: string };

const INVENT_PROMPT = `You invent presenters for short vertical videos that explain code changes, like developers who post on TikTok. Make each one a specific, memorable adult who'd be fun to watch, and easy to picture.
- name: their first name.
- look: one sentence for a photorealistic portrait: their age, at least twenty, their hair, face, and clothes, and one or two details that make them stick, like freckles, a chipped tooth, or glasses that slide down. Ordinary-looking, the way real people look on their own phones, never like a model. No real people, brands, or logos.
- room: where they film, in a few words with one or two details, like "a cluttered garage workshop with a telescope".
- voice: the voice from the list that fits them best.
- line: how they'd open a video, in their own voice, in at most fifteen words. It's said out loud, so no emoji or symbols.`;

// Asked to surprise, Grok drew nearly the same person twice in a row, even at a high temperature: late twenties, silver
// hair, a cardigan, a sunlit room. So a surprise starts from an age, a vibe, and a place picked at random.
const SPARKS = {
  age: ["in their twenties", "in their thirties", "in their forties", "in their fifties", "in their sixties", "in their seventies"],
  vibe: ["punk", "cozy", "corporate", "outdoorsy", "glamorous", "nerdy", "retro", "sporty", "goth", "theatrical", "minimalist", "chaotic"],
  place: ["a kitchen", "a parked car", "a rooftop", "a garage", "a library", "a recording studio", "a boat", "a greenhouse", "a diner booth", "a dorm room", "a cabin", "a train"],
};

export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const { voices } = await client.voice.list({ signal });
  return voices
    .filter((voice) => !NOT_FOR_VIDEO.includes(voice.voice_id))
    .map((voice) => ({ id: voice.voice_id, name: voice.name, gender: voice.gender ?? "unknown" }));
}

// Says a line in a voice with text to speech, for a fraction of a cent, so the voice can be heard before paying for a take.
export async function previewVoice(voice: string, text: string, signal?: AbortSignal): Promise<Uint8Array> {
  const speech = await client.voice.speak({ text: stripInvalidSpeechTags(text), language: "auto", voice_id: voice }, { signal });
  return speech.bytes();
}

// Has Grok make up a presenter, from an idea if there is one. The voices come with their genders, so Grok can pick one
// that fits the person it describes.
export async function inventPresenter(voices: Voice[], idea: string, signal?: AbortSignal): Promise<{ draft: Draft; cost: number }> {
  const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)];
  const start = idea.trim() ? `Start from this idea: ${idea.trim()}` : `Surprise me with someone ${pick(SPARKS.age)}, with a ${pick(SPARKS.vibe)} vibe, who films in ${pick(SPARKS.place)}.`;
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: INVENT_PROMPT },
        { role: "user", content: `${start}\n\nVoices:\n${voices.map((voice) => `- ${voice.id} (${voice.gender})`).join("\n")}` },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "presenter",
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              look: { type: "string" },
              room: { type: "string" },
              voice: { type: "string", enum: voices.map((voice) => voice.id) },
              line: { type: "string" },
            },
            required: ["name", "look", "room", "voice", "line"],
            additionalProperties: false,
          },
        },
      },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  return { draft: response.toJson() as Draft, cost: response.usage.cost_usd ?? 0 };
}

// Reads a video of the person to copy, which the studio only does once you confirm it's you or you have their permission.
// The person is whoever is talking `at` that many seconds in, or else whoever talks the most: the transcript's diarization
// says who says each word. Their speech, up to MAX_SAMPLE seconds of it, becomes the voice sample, and frames from the
// middle of what they say, when they're most likely on camera, are the likenesses to pick from. In a call recorded in
// speaker view, that's when the call shows them.
export async function readVideo(video: string, dir: string, at?: number, signal?: AbortSignal): Promise<FromVideo> {
  const audio = `${dir}/audio.mp3`;
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-t", String(READ_SECONDS), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio], { signal });
  // With diarize, the API reads the audio's format from the upload's file name, so it's sent as a named File.
  const transcript = await client.voice
    .transcribe({ file: new File([await readFile(audio)], "audio.mp3"), model: "grok-voice-transcribe-2.0", diarize: true }, { signal })
    .finally(() => rm(audio, { force: true }));
  const words = transcript.words ?? [];
  if (!words.length) throw new Error("There's no speech in the video to take a voice from.");
  const talking = new Map<number, number>();
  for (const word of words) talking.set(word.speaker ?? 0, (talking.get(word.speaker ?? 0) ?? 0) + word.end - word.start);
  const away = (word: (typeof words)[number]) => (at === undefined ? 0 : Math.max(word.start - at, at - word.end, 0));
  const speaker =
    at === undefined ? [...talking].sort((a, b) => b[1] - a[1])[0][0] : ([...words].sort((a, b) => away(a) - away(b))[0].speaker ?? 0);

  // Their speech in stretches, each running until they stop for most of a second or someone else talks.
  const stretches: Array<[start: number, end: number]> = [];
  let previous: number | undefined;
  for (const word of words) {
    const theirs = (word.speaker ?? 0) === speaker;
    const last = stretches.at(-1);
    if (theirs && last && previous === speaker && word.start - last[1] < 0.8) last[1] = word.end;
    else if (theirs) stretches.push([word.start, word.end]);
    previous = word.speaker ?? 0;
  }
  const solid = stretches.filter(([start, end]) => end - start >= MIN_STRETCH);
  const kept: Array<[number, number]> = [];
  let speech = 0;
  for (const [start, end] of solid.length ? solid : stretches) {
    if (speech >= MAX_SAMPLE) break;
    const stop = Math.min(end, start + MAX_SAMPLE - speech);
    kept.push([start, stop]);
    speech += stop - start;
  }
  // The sample is cut from the video's own sound, not the 16 kHz copy made for the transcript, so the clone hears all of it.
  const sample = `${dir}/voice.mp3`;
  const trims = kept.map(([start, end], index) => `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[s${index}]`);
  const join = `${kept.map((_, index) => `[s${index}]`).join("")}concat=n=${kept.length}:v=0:a=1,aformat=channel_layouts=mono[voice]`;
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-filter_complex", [...trims, join].join(";"), "-map", "[voice]", "-q:a", "2", sample], { signal });

  const moments = at === undefined ? framesFrom(kept) : framesAt(at, stretches);
  const frames = await Promise.all(
    moments.map(async (time, index) => {
      const frame = `${dir}/frame-${index + 1}.jpg`;
      await run("ffmpeg", ["-y", "-v", "error", "-ss", time.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "2", frame], { signal });
      return frame;
    }),
  );
  const { look, room } = await describePerson(new Blob([await readFile(frames[0])], { type: "image/jpeg" }), signal);
  return { frames, sample, speech, look, room };
}

// Without a time to look at, the frames come from the middles of their four longest stretches, since a call can take a
// moment to switch to whoever starts talking.
function framesFrom(kept: Array<[number, number]>): number[] {
  const longest = [...kept].sort((a, b) => b[1] - b[0] - (a[1] - a[0])).slice(0, 4).sort((a, b) => a[0] - b[0]);
  if (longest.length === 4) return longest.map(([start, end]) => (start + end) / 2);
  const [first, last] = [kept[0][0], kept[kept.length - 1][1]];
  return [0.1, 0.35, 0.6, 0.85].map((share) => first + share * (last - first));
}

// Given a time, the frames come from the stretch they're talking in then, since that's where you saw them. Later in a
// call, they might only be a thumbnail next to someone's shared screen.
function framesAt(at: number, stretches: Array<[number, number]>): number[] {
  const away = ([start, end]: [number, number]) => Math.max(start - at, at - end, 0);
  const nearest = [...stretches].sort((a, b) => away(a) - away(b))[0];
  const [start, end] = nearest[1] - nearest[0] >= 1.2 ? nearest : [Math.max(0, at - 1), at + 1];
  return [0, 1, 2, 3].map((index) => start + ((index + 0.5) * (end - start)) / 4);
}

// Grok describes the person and where they are, for the script and for the takes, which say where the presenter films.
async function describePerson(frame: Blob, signal?: AbortSignal): Promise<{ look: string; room: string }> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image: frame, detail: "high" },
            {
              type: "input_text",
              text: 'Describe the person in one sentence for a portrait: their apparent age, hair, face, and clothes. Then say where they are, in a few words that finish "filming in", from what you can see of the place: its walls, furniture, and light. Name the place, even if the picture is a video call.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "person",
          schema: { type: "object", properties: { look: { type: "string" }, room: { type: "string" } }, required: ["look", "room"], additionalProperties: false },
        },
      },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { look, room } = response.toJson() as { look: string; room: string };
  // Asked for words that finish "filming in", Grok sometimes starts with those words too.
  return { look, room: room.replace(/^\s*filming in\s+/i, "").replace(/\.\s*$/, "") };
}

// Makes a custom voice from the sample, which the video model takes by its voice_id like a built-in voice. Creating custom
// voices through the API takes an Enterprise plan. The voice stays in your account until you delete it with
// client.voice.custom.delete().
export async function cloneVoice(sample: string, name: string, signal?: AbortSignal): Promise<string> {
  try {
    const voice = await client.voice.custom.create({ file: new File([await readFile(sample)], "voice.mp3", { type: "audio/mpeg" }), name: `${name || "Presenter"} (Presenter Studio)` }, { signal });
    return voice.voice_id;
  } catch (error) {
    if (error instanceof PermissionDeniedError) throw new Error("Cloning a voice through the API takes an Enterprise plan, so pick one of the built-in voices instead.");
    throw error;
  }
}

// An id for a new presenter, made from their name and different from everyone saved so far.
export async function newPresenterId(name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "presenter";
  const taken = new Set((await listPresenters()).map((presenter) => presenter.id));
  let id = base;
  for (let count = 2; taken.has(id); count++) id = `${base}-${count}`;
  return id;
}
