import type { WebSocket } from "ws";

/**
 * A typed WebSocket adapter for Plivo Audio Streaming.
 *
 * Mirrors the Twilio Media Streams adapter shape used in the sibling example.
 * Protocol reference:
 * https://plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-reference
 */

export class PlivoAudioStreamWebsocket {
  ws: WebSocket;
  streamId: string | undefined;
  callId: string | undefined;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  send = (action: PlivoStreamAction) => {
    this.ws.send(JSON.stringify(action));
  };

  on = <K extends PlivoStreamMessageTypes>(
    event: K,
    handler: (msg: Extract<PlivoStreamMessage, { event: K }>) => void,
  ) =>
    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as PlivoStreamMessage;
        if (msg.event === event) {
          handler(msg as Extract<PlivoStreamMessage, { event: K }>);
        }
      } catch (error) {
        // Silently ignore parse errors
      }
    });
}

// ========================================
// Plivo Audio Streaming Types
// ========================================
export type PlivoStreamAction = ClearAudio | PlayAudio | Checkpoint | SendDTMF;

type ClearAudio = { event: "clearAudio"; streamId: string };
type PlayAudio = {
  event: "playAudio";
  media: {
    contentType: "audio/x-mulaw";
    sampleRate: 8000;
    payload: string;
  };
};
type Checkpoint = { event: "checkpoint"; streamId: string; name: string };
type SendDTMF = { event: "sendDTMF"; dtmf: string };

export type PlivoStreamMessage =
  | StartEvent
  | MediaEvent
  | DTMFEvent
  | PlayedStreamEvent
  | ClearedAudioEvent;

export type StartEvent = {
  event: "start";
  sequenceNumber: number;
  start: {
    callId: string;
    streamId: string;
    accountId: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
    };
  };
  extra_headers?: string;
};

export type MediaEvent = {
  event: "media";
  sequenceNumber: number;
  streamId: string;
  media: {
    track: string;
    timestamp: string;
    chunk: number;
    payload: string;
  };
  extra_headers?: string;
};

export type DTMFEvent = {
  event: "dtmf";
  sequenceNumber: number;
  streamId: string;
  dtmf: {
    track: string;
    digit: string;
    timestamp: string;
  };
  extra_headers?: string;
};

export type PlayedStreamEvent = {
  event: "playedStream";
  sequenceNumber: number;
  streamId: string;
  name: string;
};

export type ClearedAudioEvent = {
  event: "clearedAudio";
  sequenceNumber: number;
  streamId: string;
};

export type PlivoStreamMessageTypes = PlivoStreamMessage["event"];
