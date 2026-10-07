import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { SpaceXAI } from "@xai-official/sdk";
import { LANGUAGES, PRICE_PER_MINUTE, REALTIME_URL, SAMPLE_RATE, createSession } from "./interpreter.ts";

const TTS_PRICE_PER_CHARACTER = 15 / 1_000_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { from: { type: "string", default: "en" }, to: { type: "string", default: "es-MX" } },
});
const { from, to } = values;
if (!(from in LANGUAGES) || !(to in LANGUAGES) || from === to) {
  console.error(`Usage: npm start -- [--from en] [--to es-MX] [what to say]\nLanguages: ${Object.keys(LANGUAGES).join(", ")}`);
  process.exit(1);
}
const text = positionals.join(" ") || "Hi! Could you tell me where the nearest train station is? I'm meeting a friend there at six.";

// A session needs someone talking, so this records the text with text to speech, as raw PCM in the
// session's format, to stand in for a microphone.
console.log(`Recording "${text}" with text to speech`);
const speech = await new SpaceXAI().voice.speak({
  text,
  language: from,
  voice_id: "rex",
  output_format: { codec: "pcm", sample_rate: SAMPLE_RATE },
});
const clip = await speech.bytes();

const { socket, settings } = await connect();
socket.send(JSON.stringify({ type: "session.update", session: settings }));

const translation: Uint8Array[] = [];
let translated = "";
let stoppedAt = 0;
let firstAudioAt = 0;
let done = false;
const timeout = setTimeout(() => end("No translation came back within 30 seconds."), 30_000);

socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  switch (event.type) {
    case "session.updated":
      // The token's own settings arrive first, in an update without instructions.
      if (event.session.instructions) streamClip();
      break;
    case "input_audio_buffer.speech_stopped":
      stoppedAt = performance.now();
      break;
    case "conversation.item.input_audio_transcription.completed":
      // grok-transcribe sends this for each partial transcript too, marked in_progress.
      if (event.status === "completed") console.log(`${LANGUAGES[from]}: ${event.transcript}`);
      break;
    case "response.output_audio_transcript.delta":
      if (!translated) process.stdout.write(`${LANGUAGES[to]}: `);
      translated += event.delta;
      process.stdout.write(event.delta);
      break;
    case "response.output_audio.delta":
      firstAudioAt ||= performance.now();
      translation.push(Buffer.from(event.delta, "base64"));
      break;
    case "response.done":
      finish(event.usage?.billable_audio_seconds);
      break;
    case "error":
      console.error(`\n${event.error.message}`);
      break;
  }
};
socket.onclose = () => end("The session closed before Grok said anything.");

// Opens a session the way the page does. Browsers can't set headers on a WebSocket, so the token goes
// in as a subprotocol. About one connection in ten opens and then never starts a session, so each try
// gets five seconds, and a new token, since a token opens only one session.
async function connect(): Promise<{ socket: WebSocket; settings: object }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { token, settings } = await createSession(from, to);
    const socket = new WebSocket(REALTIME_URL, [`xai-client-secret.${token}`]);
    const started = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      socket.onmessage = ({ data }) => {
        if (JSON.parse(data).type !== "session.created") return;
        clearTimeout(timer);
        resolve(true);
      };
      socket.onclose = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (started) {
      console.log(`Connected to ${REALTIME_URL} with a new token\n`);
      return { socket, settings };
    }
    socket.onmessage = socket.onclose = null;
    socket.close();
    console.log("The session didn't start, so trying again with a new token");
  }
  console.error("Couldn't start a session in three tries.");
  process.exit(1);
}

// Sends the clip the way a microphone would, 100 ms at a time in real time, then a second and a half
// of silence so server VAD can tell the speaker has stopped.
async function streamClip(): Promise<void> {
  const chunk = (SAMPLE_RATE / 10) * 2;
  const audio = Buffer.concat([clip, Buffer.alloc(chunk * 15)]);
  for (let offset = 0; offset < audio.length && socket.readyState === WebSocket.OPEN; offset += chunk) {
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audio.subarray(offset, offset + chunk).toString("base64") }));
    await sleep(100);
  }
}

async function finish(billedSeconds = 0): Promise<void> {
  if (!translation.length || !translated) return end("Grok's turn ended without speech.");
  end();
  await mkdir("output", { recursive: true });
  await writeFile("output/original.wav", wav(clip));
  await writeFile("output/translation.wav", wav(Buffer.concat(translation)));
  const seconds = translation.reduce((sum, part) => sum + part.length, 0) / 2 / SAMPLE_RATE;
  console.log(`\n\nGrok started speaking ${((firstAudioAt - stoppedAt) / 1000).toFixed(1)} seconds after the speaker stopped.`);
  console.log(`Saved ${seconds.toFixed(1)} seconds of it to output/translation.wav, next to output/original.wav.`);
  console.log(`Cost: $${((billedSeconds / 60) * PRICE_PER_MINUTE).toFixed(3)} for ${billedSeconds} seconds of speech to speech, and $${(text.length * TTS_PRICE_PER_CHARACTER).toFixed(4)} for the text to speech.`);
}

function end(failure?: string): void {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  socket.close();
  if (failure) {
    console.error(`\n${failure}`);
    process.exitCode = 1;
  }
  // A connection that never started doesn't finish closing either, so don't let one keep the script running.
  setTimeout(() => process.exit(), 3000).unref();
}

// The session sends raw 16-bit mono PCM. This header in front of it makes a WAV file that any player opens.
function wav(pcm: Uint8Array): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
