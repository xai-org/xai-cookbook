import { styleText } from "node:util";
import { DEFAULT_LANGUAGE, type Step, dubVideo, languageName } from "./dub.ts";

// Recording starts while the translation is still streaming, so it doesn't get a line of its own.
const STEPS: Partial<Record<Step, string>> = {
  transcribe: "Transcribing the video",
  translate: "Translating the lines, and recording each one as soon as it's translated",
  mix: "Mixing the dub over the original sound",
};

const video = process.argv[2] ?? "sample-clip.mp4";
const language = process.argv[3] ?? DEFAULT_LANGUAGE;
const started = Date.now();
console.log(styleText("bold", `Dubbing ${video} into ${languageName(language)}`));

const dub = await dubVideo(video, language, {
  step: (step, status) => {
    const label = STEPS[step];
    if (status === "active" && label) console.log(label);
  },
  transcript: ({ language, duration, lines, voices }) => {
    console.log(styleText("dim", `  ${plural(lines.length, "line")} in ${languageName(language)}, ${duration.toFixed(1)} seconds long`));
    voices.forEach((voice, speaker) => console.log(styleText("dim", `  Speaker ${speaker + 1} is voiced by ${voice[0].toUpperCase()}${voice.slice(1)}`)));
  },
  take: (line, take, next) => {
    const over = `${(take.length - line.slot).toFixed(1)} s too long`;
    if (next === "shorten") console.log(styleText("dim", `  Line ${line.id} ran ${over}, shortening “${take.text}”`));
    if (next === "speed up") console.log(styleText("dim", `  Line ${line.id} ran ${over}, recording it faster`));
  },
});

console.log();
dub.lines.forEach((line, index) => {
  const { take, shortenings } = dub.fits[index];
  const note = [
    `${take.length.toFixed(1)} of ${line.slot.toFixed(1)} s`,
    shortenings ? `shortened ${shortenings === 1 ? "once" : "twice"}` : "",
    take.speed > 1 ? `${take.speed}× speed` : "",
  ].filter(Boolean);
  console.log(`${clock(line.start)}  ${styleText("dim", line.text)}`);
  console.log(`        ${take.text}  ${styleText("dim", note.join(", "))}`);
});

const { transcription, translation, speech } = dub.cost;
const shortened = dub.fits.filter((fit) => fit.shortenings).length;
console.log(`\nSaved ${dub.video}`);
console.log(`Shortened ${shortened} of ${plural(dub.lines.length, "line")}. Took ${Math.round((Date.now() - started) / 1000)} seconds.`);
console.log(
  `Cost: $${(transcription + translation + speech).toFixed(3)} (transcription $${transcription.toFixed(4)}, Grok $${translation.toFixed(3)}, speech $${speech.toFixed(3)})`,
);

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
