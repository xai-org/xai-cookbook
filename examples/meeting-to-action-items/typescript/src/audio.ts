import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();

// 16 kHz is the transcription model's own rate, so the server doesn't have to resample.
export const SAMPLE_RATE = 16000;
export const SAMPLE_PATH = "output/sample-meeting.wav";
const SCRIPT = new URL("../sample-meeting.json", import.meta.url);
// Text to speech costs $15 per million characters.
const TTS_USD_PER_CHARACTER = 15 / 1_000_000;
// The rates streaming transcription takes 16-bit PCM at.
const RATES = [8000, 16000, 22050, 24000, 44100, 48000];

type Script = { voices: Record<string, string>; turns: Array<{ speaker: string; text: string }> };

// Records the sample meeting from sample-meeting.json, with a voice for each speaker, and saves it to
// output/. Returns what the speech cost, or 0 if it was already recorded.
export async function recordSampleMeeting(signal?: AbortSignal): Promise<number> {
  if (existsSync(SAMPLE_PATH)) return 0;
  const script = JSON.parse(await readFile(SCRIPT, "utf8")) as Script;
  const clips = await Promise.all(
    script.turns.map(async (turn) => {
      const speech = await client.voice.speak(
        {
          text: turn.text,
          language: "en",
          voice_id: script.voices[turn.speaker],
          // Raw 16 kHz PCM streams as it is, and a WAV header is all the page needs to play it.
          output_format: { codec: "pcm", sample_rate: SAMPLE_RATE },
        },
        { signal },
      );
      return Buffer.from(await speech.bytes());
    }),
  );
  const pause = silence(0.6);
  const pcm = Buffer.concat([silence(0.5), ...clips.flatMap((clip) => [clip, pause]), silence(2)]);
  await mkdir("output", { recursive: true });
  await writeFile(SAMPLE_PATH, wav(pcm, SAMPLE_RATE));
  return script.turns.reduce((sum, turn) => sum + turn.text.length, 0) * TTS_USD_PER_CHARACTER;
}

// Reads a WAV file of 16-bit mono PCM as it is. Anything else goes through ffmpeg, if it's installed.
export async function readAudio(path: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  const audio = readWav(await readFile(path));
  if (audio) return audio;
  const ffmpeg = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"], {
    maxBuffer: 2 ** 31,
  });
  if (ffmpeg.error) throw new Error(`Install ffmpeg to read ${path}, or pass a WAV file of 16-bit mono PCM.`);
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg couldn't read ${path}: ${ffmpeg.stderr}`);
  return { pcm: ffmpeg.stdout, sampleRate: SAMPLE_RATE };
}

// Sends the audio in 100 ms chunks, as fast as it plays, the way a microphone would.
export async function streamAudio(pcm: Buffer, sampleRate: number, send: (chunk: Uint8Array) => void, signal?: AbortSignal): Promise<void> {
  const size = (sampleRate / 10) * 2;
  const start = Date.now();
  for (let chunk = 0; chunk * size < pcm.length; chunk++) {
    send(pcm.subarray(chunk * size, (chunk + 1) * size));
    await sleep(start + (chunk + 1) * 100 - Date.now(), undefined, { signal });
  }
}

function readWav(bytes: Buffer): { pcm: Buffer; sampleRate: number } | undefined {
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE") return undefined;
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const chunk = bytes.toString("latin1", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunk === "fmt ") {
      format = {
        encoding: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    }
    if (chunk === "data") {
      const pcm16 = format?.encoding === 1 && format.channels === 1 && format.bits === 16 && RATES.includes(format.sampleRate);
      return pcm16 && format ? { pcm: bytes.subarray(body, body + size), sampleRate: format.sampleRate } : undefined;
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2);
  }
  return undefined;
}

// A WAV file is a 44-byte header followed by the samples.
function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // uncompressed PCM
  header.writeUInt16LE(1, 22); // one channel
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function silence(seconds: number): Buffer {
  return Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);
}
