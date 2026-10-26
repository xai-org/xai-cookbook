import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SpaceXAI } from "@xai-official/sdk";
import type { Cut } from "./project.ts";

const client = new SpaceXAI({ maxRetries: 3 });
const run = promisify(execFile);

// A problem Grok saw in a cut: when, where in the frame from 0 to 1 from the top left, and what to do about it.
export type Issue = { time: number; x: number; y: number; text: string };

// Where in each segment's take a frame is looked at: just after it starts, halfway, and just before it ends.
const LOOKS = [0.15, 0.5, 0.85];

const SYSTEM = `You're the editor checking a vertical short video before it's posted. You get frames from every segment, each with the line the presenter says in it and how it's laid out.

How the video works, so you don't mistake it for a problem: captions show a few words of the line at a time, as they're said, so a caption that stops mid-sentence isn't cut off, and the word being said is a different color. The presenter can be in a split under a screen, full screen, or keyed over a visual in front of a green screen, and before a line, they can silently watch a clip that plays above them or, keyed out, behind them.

Point out only real problems a viewer would notice:
- On-screen text that's cut off, runs off the screen, or overlaps other text.
- Captions covering the presenter's face or the part of a screenshot that matters.
- A screenshot too small or blurry to read when the line is about what's in it.
- A presenter who looks doubled, ghosted, see-through, or has green edges around them.
- A face cut off by the edge of the frame.
- A blank, black, or broken frame.
- A visual that has nothing to do with what's being said.
- Typos in on-screen text.

Don't comment on taste, pacing, the presenter's acting, or the script itself. Frames from the same segment show the same layout, so report a problem once, at the frame where it's clearest. For each problem, give the frame's number, where in that frame it is as x and y from 0 to 1 from the top left, what's wrong in one short sentence, and what to change in one short sentence, written to the person editing the video. At most six problems, the worst first. If nothing's wrong, return no problems.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: { frame: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, problem: { type: "string" }, fix: { type: "string" } },
        required: ["frame", "x", "y", "problem", "fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["problems"],
  additionalProperties: false,
};

// Grok watches a cut the way an editor would before it goes out: three frames from every segment, with what each one says
// and how it's laid out, and points at anything that looks broken. It costs a few cents at most.
export async function reviewCut(cut: Cut, signal?: AbortSignal): Promise<{ issues: Issue[]; cost: number }> {
  const frames = cut.parts.flatMap((part, index) => LOOKS.map((at) => ({ time: part.start + (part.end - part.start) * at, index })));
  const pictures = await Promise.all(frames.map(({ time }) => frameAt(cut.video, time, signal)));
  const content = frames.flatMap(({ time, index }, number) => {
    const segment = cut.segments[index];
    const about = `Frame ${number + 1}, at ${time.toFixed(1)} seconds, in segment ${index + 1} ("${segment?.label ?? cut.parts[index].kind}", laid out as ${cut.parts[index].layout}), where the presenter says: "${segment?.line ?? ""}"`;
    return [{ type: "input_text" as const, text: about }, { type: "input_image" as const, image: pictures[number], detail: "high" as const }];
  });
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      text: { format: { type: "json_schema", name: "review", schema: REVIEW_SCHEMA } },
      reasoning: { effort: "low" },
    },
    { signal },
  );
  const { problems } = response.toJson() as { problems: Array<{ frame: number; x: number; y: number; problem: string; fix: string }> };
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
  const issues = problems
    .filter(({ frame }) => frames[frame - 1])
    .slice(0, 6)
    .map(({ frame, x, y, problem, fix }) => ({ time: frames[frame - 1].time, x: clamp(x), y: clamp(y), text: `${problem.trim()} ${fix.trim()}` }));
  return { issues, cost: response.usage.cost_usd ?? 0 };
}

// A frame of the video at `time`, as a JPEG small enough that a few dozen of them are cheap to send.
async function frameAt(video: string, time: number, signal?: AbortSignal): Promise<Blob> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", time.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=432:768", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 24, signal });
  return new Blob([stdout], { type: "image/jpeg" });
}
