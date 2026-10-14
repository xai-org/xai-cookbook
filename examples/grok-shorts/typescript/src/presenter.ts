import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();
const DIR = "output/presenters";

// A presenter: how Grok Imagine draws them, the voice the video model speaks in, their personality, which is how they talk
// and act unless a video asks for another, and once they're drawn, where their face is in the portrait, as a share of
// its width and height, so the video can frame it. `green` is the color of the green screen behind them in their green
// screen portrait, once it's drawn, as hex. `personality` is the id of a built-in personality or a saved one.
export type Presenter = { id: string; name: string; voice: string; look: string; room: string; personality?: string; face?: { x: number; y: number }; green?: string };

const GREEN_SCREEN =
  "The same person, exactly as they are: the same face, hair, clothes, pose, framing, and the light on them. Replace everything behind them with a flat, evenly lit chroma key green screen that fills the whole background, with no shadows, objects, or texture on it.";

const HOME_OFFICE = "a cozy home office at night, with a warm desk lamp, a soft ring light, and a monitor glowing behind them";

// Drawn the first time they're used. Presenter Studio makes more, and saves them next to these in output/presenters/.
export const BUILT_IN: Presenter[] = [
  {
    id: "maya",
    name: "Maya",
    voice: "eve",
    look: "a software engineer in her late twenties with curly dark hair, small gold hoops, and an oversized cream knit sweater",
    room: HOME_OFFICE,
    personality: "hype",
  },
  {
    id: "dev",
    name: "Dev",
    voice: "rex",
    look: "a software engineer in his late twenties with short dark hair, light stubble, and a charcoal hoodie",
    room: HOME_OFFICE,
    personality: "deadpan",
  },
];

// How the presenter talks and acts, unless a video asks for another personality. Presenters saved before they had one
// are hype creators.
export function personalityOf(presenter: Presenter): string {
  return presenter.personality || "hype";
}

// Every take starts from the portrait, which keeps the presenter, the room, and the framing the same from cut to cut. The
// framing leaves room above their head, where the video puts the code.
export function portraitPrompt(look: string, room: string): string {
  return `A photorealistic vertical phone video frame of ${look}, filming a TikTok in ${room}. Looking straight into the camera with a friendly, expressive face, mouth closed. Framed from the chest up in the lower half of the frame, with plenty of empty space above the head. Soft, flattering light, shallow depth of field, natural skin texture.`;
}

// The built-in presenters, then everyone saved from the studio. A built-in presenter saved with their face found, or
// changed in the studio, keeps anything that wasn't saved, like a personality added since.
export async function listPresenters(): Promise<Presenter[]> {
  const saved = existsSync(DIR) ? (await readdir(DIR)).filter((name) => name.endsWith(".json")) : [];
  const studio = await Promise.all(saved.map(async (name) => JSON.parse(await readFile(`${DIR}/${name}`, "utf8")) as Presenter));
  return [...BUILT_IN.map((presenter) => ({ ...presenter, ...studio.find((each) => each.id === presenter.id) })), ...studio.filter((each) => !BUILT_IN.some((presenter) => presenter.id === each.id))];
}

export async function findPresenter(id: string): Promise<Presenter> {
  const presenter = (await listPresenters()).find((each) => each.id === id);
  if (!presenter) throw new Error(`There's no presenter called "${id}".`);
  return presenter;
}

// The presenter's portrait. A built-in presenter is drawn the first time they're used, and their face found and saved, the
// same way the studio saves a presenter.
export async function drawPresenter(presenter: Presenter, signal?: AbortSignal): Promise<{ file: string; portrait: Blob; face: { x: number; y: number }; cost: number }> {
  const file = `${DIR}/${presenter.id}.jpg`;
  let cost = 0;
  if (!existsSync(file)) {
    const drawn = await drawPortraits(presenter.look, presenter.room, 1, signal);
    cost += drawn.cost;
    await mkdir(DIR, { recursive: true });
    await writeFile(file, drawn.images[0]);
  }
  const portrait = new Blob([await readFile(file)], { type: "image/jpeg" });
  let face = presenter.face;
  if (!face) {
    const found = await findFace(portrait, signal);
    cost += found.cost;
    face = found.face;
    await savePresenter({ ...presenter, face });
  }
  return { file, portrait, face, cost };
}

// The presenter in front of a green screen, for takes that are cut out and put in front of a beat's visual. It's drawn
// once, from their portrait, so the framing and their face stay the same, and the green it came out as is saved, since
// that's the color to key out.
export async function drawGreenPortrait(presenter: Presenter, portrait: Blob, signal?: AbortSignal): Promise<{ portrait: Blob; green: string; cost: number }> {
  const file = `${DIR}/${presenter.id}-green.jpg`;
  if (existsSync(file) && presenter.green) return { portrait: new Blob([await readFile(file)], { type: "image/jpeg" }), green: presenter.green, cost: 0 };
  const response = await client.images.edit(
    { model: "grok-imagine-image-2.0", image: portrait, prompt: GREEN_SCREEN, aspect_ratio: "9:16", response_format: "b64_json" },
    { signal },
  );
  const image = response.data[0]?.b64_json;
  if (!image) throw new Error(`Grok Imagine didn't draw ${presenter.name} in front of a green screen.`);
  const drawn = Buffer.from(image, "base64");
  await writeFile(file, drawn);
  const green = await cornerColor(drawn);
  await savePresenter({ ...presenter, green });
  return { portrait: new Blob([drawn], { type: "image/jpeg" }), green, cost: response.usage?.cost_usd ?? 0 };
}

// The average color of a patch near the top left corner of a picture, as hex.
async function cornerColor(picture: Buffer): Promise<string> {
  const image = await loadImage(picture);
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 16, 16, 32, 32, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  const average = [0, 1, 2].map((channel) => Math.round(data.filter((_, index) => index % 4 === channel).reduce((sum, value) => sum + value, 0) / (32 * 32)));
  return average.map((value) => value.toString(16).padStart(2, "0")).join("");
}

// Draws portraits of the presenter from their description, or with `likeness`, a picture of the person, by editing the
// picture into the same framing, which keeps their face.
export async function drawPortraits(look: string, room: string, count: number, signal?: AbortSignal, likeness?: Blob): Promise<{ images: Buffer[]; cost: number }> {
  const request = { model: "grok-imagine-image-2.0", aspect_ratio: "9:16", n: count, response_format: "b64_json" } as const;
  const response = likeness
    ? await client.images.edit(
        {
          ...request,
          image: likeness,
          prompt: `${portraitPrompt("the person in the picture, keeping their exact face, hair, and build", room)} Leave out any text, name labels, or video call interface.`,
        },
        { signal },
      )
    : await client.images.generate({ ...request, prompt: portraitPrompt(look, room) }, { signal });
  const images = response.data.flatMap((image) => (image.b64_json ? [Buffer.from(image.b64_json, "base64")] : []));
  if (!images.length) throw new Error("Grok Imagine didn't draw a portrait. Try describing the presenter another way.");
  return { images, cost: response.usage?.cost_usd ?? 0 };
}

// Grok looks at the portrait and says where the face is. The portraits are all framed the same way, but the face can still
// land higher or lower, and the video keeps the face in the same spot whatever the portrait.
export async function findFace(portrait: Blob, signal?: AbortSignal): Promise<{ face: { x: number; y: number }; cost: number }> {
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image: portrait, detail: "high" },
            {
              type: "input_text",
              text: "Where is the person's face in this picture? Give the center of the face, between the eyes and the mouth, as a fraction of the picture's width from the left and of its height from the top.",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "face",
          schema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false },
        },
      },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { x, y } = response.toJson() as { x: number; y: number };
  const clamp = (value: number) => Math.min(Math.max(value, 0.2), 0.8);
  return { face: { x: clamp(x), y: clamp(y) }, cost: response.usage.cost_usd ?? 0 };
}

export async function savePresenter(presenter: Presenter, portrait?: Uint8Array): Promise<void> {
  await mkdir(DIR, { recursive: true });
  if (portrait) await writeFile(`${DIR}/${presenter.id}.jpg`, portrait);
  await writeFile(`${DIR}/${presenter.id}.json`, JSON.stringify(presenter, null, 2));
}
