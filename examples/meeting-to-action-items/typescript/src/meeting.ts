import { randomUUID } from "node:crypto";
import { type AnswerEvents, NO_NOTES, type Notes, type NotesEvents, answer, reviseNotes } from "./notes.ts";
import { type Line, type TranscriptEvents, transcribe } from "./transcribe.ts";

// Streaming transcription costs $0.20 an hour. The stream doesn't report a cost, so it's worked out from
// the duration.
const TRANSCRIPTION_USD_PER_HOUR = 0.2;
// How many lines the notes already cover go along with the new ones, for context.
const EARLIER_LINES = 3;

export type MeetingEvents = TranscriptEvents &
  NotesEvents & {
    // Grok started revising the notes with these new lines.
    revising?: (lines: Line[]) => void;
    notes?: (notes: Notes) => void;
    // A revision failed. Its lines go into the next one.
    error?: (error: Error) => void;
  };

export type Meeting = {
  id: string;
  lines: Line[];
  notes: Notes;
  cost: { transcription: number; notes: number; questions: number };
  send: (audio: Uint8Array) => void;
  // Settles early, with an error, only if the transcription breaks.
  done: Promise<number>;
  // Ends the audio, waits for the last words, and brings the notes up to date.
  finish: () => Promise<void>;
};

// Starts transcribing 16-bit mono PCM, and has Grok revise the notes each time a turn ends.
export async function startMeeting(sampleRate: number, on: MeetingEvents = {}, signal?: AbortSignal): Promise<Meeting> {
  // How many lines have ended, and how many of those the notes cover.
  let ended = 0;
  let covered = 0;
  let revision: Promise<void> | undefined;

  const transcriber = await transcribe(
    sampleRate,
    {
      interim: on.interim,
      line: (line, open) => {
        on.line?.(line, open);
        if (open) return;
        ended = line.id;
        revise();
      },
    },
    signal,
  );
  const meeting: Meeting = {
    id: randomUUID(),
    lines: transcriber.lines,
    notes: NO_NOTES,
    cost: { transcription: 0, notes: 0, questions: 0 },
    send: transcriber.send,
    done: transcriber.done,
    finish,
  };
  return meeting;

  // One revision runs at a time, and the turns that end while it runs all go into the next one, so the
  // notes stay at most one revision behind however fast people talk.
  function revise(): void {
    const fresh = meeting.lines.slice(covered, ended);
    if (revision || !fresh.length || signal?.aborted) return;
    on.revising?.(fresh);
    const earlier = meeting.lines.slice(Math.max(0, covered - EARLIER_LINES), covered);
    revision = reviseNotes(meeting.notes, fresh, earlier, on, { cacheKey: meeting.id, signal })
      .then(({ notes, cost }) => {
        meeting.notes = notes;
        meeting.cost.notes += cost;
        covered += fresh.length;
        on.notes?.(notes);
        return true;
      })
      .catch((error) => {
        if (!signal?.aborted) on.error?.(error instanceof Error ? error : new Error(String(error)));
        return false;
      })
      .then((revised) => {
        revision = undefined;
        if (revised) revise();
      });
  }

  async function finish(): Promise<void> {
    const seconds = await transcriber.finish();
    meeting.cost.transcription = (seconds / 3600) * TRANSCRIPTION_USD_PER_HOUR;
    // No turn comes after the last revision to try again, so a failed one is retried here.
    for (let attempt = 0; attempt < 3 && covered < ended && !signal?.aborted; attempt++) {
      revise();
      while (revision) await revision;
    }
  }
}

// Answers a question about a meeting, while it's running or after it ends.
export async function ask(meeting: Meeting, question: string, on: AnswerEvents = {}, signal?: AbortSignal): Promise<{ text: string; cost: number }> {
  const result = await answer(question, meeting.lines, meeting.notes, on, { cacheKey: meeting.id, signal });
  meeting.cost.questions += result.cost;
  return result;
}
