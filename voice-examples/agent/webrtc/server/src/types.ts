/**
 * Type definitions for WebRTC server
 */

import type { RTCPeerConnection } from "werift";
import type WebSocket from "ws";

// Session state
export interface Session {
  id: string;
  created_at: string;
  status: "created" | "active" | "closed";
  sample_rate: number;
  webrtcStats?: WebRTCStats;
}

// WebRTC connection statistics
export interface WebRTCStats {
  bitrate: {
    audio_in: number;
    audio_out: number;
  };
  jitter: number;
  packetLoss: number;
  connectionState: string;
  iceConnectionState: string;
  lastUpdated: string;
}

// WebRTC signaling messages
export type SignalingMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice-candidate"; candidate: any }
  | { type: "ready" }
  | { type: "error"; message: string };

// XAI API message types
export interface XAIMessage {
  type: string;
  [key: string]: any;
}

// Peer connection manager state
export interface PeerConnectionState {
  pc: RTCPeerConnection;
  dataChannel: any;
  audioTrack: any;
  xaiWs: WebSocket | null;
  sessionId: string;
  stats: WebRTCStats;
}

// Audio buffer for processing
export interface AudioBuffer {
  data: Buffer;
  timestamp: number;
  sampleRate: number;
}

