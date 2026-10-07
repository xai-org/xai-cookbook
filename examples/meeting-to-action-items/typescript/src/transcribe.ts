// The SDK only wraps batch transcription, so this opens the streaming endpoint as a plain WebSocket.
const STT_URL = "wss://api.x.ai/v1/stt";

// One speaker's turn. Speakers are numbered from 1, in the order the API first hears them.
export type Line = { id: number; speaker: number; start: number; text: string };

export type TranscriptEvents = {
  // The words heard since the last final result, which may still change. Interim results don't say who
  // is speaking, so these words join a line only once they're final.
  interim?: (text: string) => void;
  // A line got more final text, or ended.
  line?: (line: Line, open: boolean) => void;
};

export type Transcriber = {
  lines: Line[];
  send: (audio: Uint8Array) => void;
  // Tells the API the audio is over, and resolves to how many seconds it transcribed.
  finish: () => Promise<number>;
  // Settles when the stream ends: after finish(), or early with an error if the stream breaks.
  done: Promise<number>;
};

type Word = { text: string; start: number; speaker?: number };
type ServerEvent =
  | { type: "transcript.created" }
  | { type: "transcript.partial"; text: string; words: Word[]; is_final: boolean; speech_final: boolean }
  | { type: "transcript.done"; words: Word[]; duration: number }
  | { type: "error"; message: string };

// Opens a streaming transcription of 16-bit mono PCM and turns its results into lines, one per turn.
export async function transcribe(sampleRate: number, on: TranscriptEvents = {}, signal?: AbortSignal): Promise<Transcriber> {
  if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to your SpaceXAI API key.");
  const params = new URLSearchParams({
    model: "grok-voice-transcribe-2.0",
    encoding: "pcm",
    sample_rate: String(sampleRate),
    language: "en",
    format: "true",
    interim_results: "true",
    diarize: "true",
    // At each pause, Smart Turn scores how likely it is that the speaker has finished. In our tests a pause
    // in the middle of a sentence scored as high as 0.82, so a turn ends only above 0.9, or after 3 seconds
    // of silence. A line also ends when diarization hears someone else, which catches the rest.
    smart_turn: "0.9",
    smart_turn_timeout: "3000",
  });
  // Browsers can't set headers on a WebSocket, but Node's built-in one takes them as an extension,
  // so the API key stays on the server.
  const socket = new WebSocket(`${STT_URL}?${params}`, { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` } });
  signal?.addEventListener("abort", () => socket.close());

  let settle!: { resolve: (duration: number) => void; reject: (error: unknown) => void };
  const done = new Promise<number>((resolve, reject) => (settle = { resolve, reject }));
  // Callers see a failure through done or finish(). This keeps a failure nobody is waiting for yet from
  // crashing the process.
  done.catch(() => {});

  const lines: Line[] = [];
  let open: Line | undefined;
  // The end of a turn repeats all of its words, so words that start before the last one heard are skipped.
  let heard = -1;
  let connected = false;

  function addWords(words: Word[] = [], turnEnded = false): void {
    const changed = new Set<Line>();
    for (const word of words) {
      if (word.start <= heard) continue;
      heard = word.start;
      const speaker = (word.speaker ?? 0) + 1;
      if (open && open.speaker !== speaker) {
        changed.add(open);
        open = undefined;
      }
      if (open) {
        open.text += ` ${word.text}`;
      } else {
        open = { id: lines.length + 1, speaker, start: word.start, text: word.text };
        lines.push(open);
      }
      changed.add(open);
    }
    if (turnEnded && open) {
      changed.add(open);
      open = undefined;
    }
    for (const line of changed) on.line?.(line, line === open);
  }

  socket.onmessage = (message) => {
    const event = JSON.parse(String(message.data)) as ServerEvent;
    if (event.type === "transcript.partial" && !event.is_final) on.interim?.(event.text);
    if (event.type === "transcript.partial" && event.is_final) {
      addWords(event.words, event.speech_final);
      on.interim?.("");
    }
    if (event.type === "transcript.done") {
      addWords(event.words, true);
      settle.resolve(event.duration);
    }
    if (event.type === "error") settle.reject(new Error(event.message));
  };
  socket.onclose = () => {
    const message = connected ? "The transcription stream closed early." : "Couldn't connect to streaming transcription. Check XAI_API_KEY.";
    settle.reject(signal?.aborted ? signal.reason : new Error(message));
  };

  // The API sends transcript.created once it's ready for audio.
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("message", () => resolve(), { once: true });
    done.catch(reject);
  });
  connected = true;

  return {
    lines,
    send: (audio) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(audio);
    },
    finish: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "audio.done" }));
      return done;
    },
    done,
  };
}
