/**
 * TypeScript type definitions for WebSocket messages
 */

// Base message type
export interface BaseMessage {
  type: string;
  [key: string]: any;
}

// Client → Server messages
export interface AudioAppendMessage extends BaseMessage {
  type: "input_audio_buffer.append";
  audio: string; // base64 PCM16 (native sample rate)
}

export interface AudioCommitMessage extends BaseMessage {
  type: "input_audio_buffer.commit";
}

export interface ResponseCreateMessage extends BaseMessage {
  type: "response.create";
}

// Server → Client messages
export interface ConversationCreatedMessage extends BaseMessage {
  type: "conversation.created";
  conversation?: {
    id: string;
  };
}

export interface SessionCreatedMessage extends BaseMessage {
  type: "session.created";
  session?: any;
}

export interface SessionUpdatedMessage extends BaseMessage {
  type: "session.updated";
  session?: any;
}

export interface SpeechStartedMessage extends BaseMessage {
  type: "input_audio_buffer.speech_started";
  audio_start_ms?: number;
}

export interface SpeechStoppedMessage extends BaseMessage {
  type: "input_audio_buffer.speech_stopped";
  audio_end_ms?: number;
}

export interface ResponseOutputAudioDeltaMessage extends BaseMessage {
  type: "response.output_audio.delta";
  delta: string; // base64 PCM16 (native sample rate)
}

export interface ResponseOutputAudioTranscriptDeltaMessage extends BaseMessage {
  type: "response.output_audio_transcript.delta";
  delta: string;
}

export interface ResponseCreatedMessage extends BaseMessage {
  type: "response.created";
}

export interface ResponseDoneMessage extends BaseMessage {
  type: "response.done";
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  error?: {
    type?: string;
    code?: string;
    message?: string;
  };
}

export interface InputAudioBufferCommittedMessage extends BaseMessage {
  type: "input_audio_buffer.committed";
  item_id?: string;
}

// Union type for all messages
export type Message =
  | AudioAppendMessage
  | AudioCommitMessage
  | ResponseCreateMessage
  | ConversationCreatedMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | SpeechStartedMessage
  | SpeechStoppedMessage
  | ResponseOutputAudioDeltaMessage
  | ResponseOutputAudioTranscriptDeltaMessage
  | ResponseCreatedMessage
  | ResponseDoneMessage
  | ErrorMessage
  | InputAudioBufferCommittedMessage
  | BaseMessage;

// Debug log entry
export interface DebugLogEntry {
  timestamp: string;
  direction: "SEND" | "RECV";
  type: string;
  message: Message;
}

// Transcript entry
export interface TranscriptEntry {
  timestamp: string;
  role: "user" | "assistant";
  content: string;
}

