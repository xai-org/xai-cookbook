/**
 * WebRTC Hook for peer connection and signaling
 * Uses ephemeral tokens for authentication
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "../types/messages";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

interface SessionResponse {
  client_secret: {
    value: string;
    expires_at: number;
  };
  voice: string;
  instructions: string;
  error?: string;
}

// Enable TURN servers for restrictive networks (adds 10-15s delay if TURN server is slow/unreachable)
// Set to false for development/most networks (STUN is sufficient)
const ENABLE_TURN = true;

// Helper to get timestamp with milliseconds for debugging
const getTimestamp = () => {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
};

export interface DebugLog {
  timestamp: string;
  direction: "SEND" | "RECV";
  type: string;
  message: any;
}

interface UseWebRTCResult {
  isConnected: boolean;
  isConnecting: boolean;
  connect: (sampleRate: number) => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: Message) => void;
  debugLogs: DebugLog[];
  clearLogs: () => void;
  provider: string;
  connectionQuality: "excellent" | "good" | "fair" | "poor" | "unknown";
  peerConnection: RTCPeerConnection | null;
}

export function useWebRTC(
  onMessage: (message: Message) => void
): UseWebRTCResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "fair" | "poor" | "unknown">("unknown");

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const signalingWsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const provider = "WebRTC"; // Always WebRTC for this client

  /**
   * Add a debug log entry
   */
  const addLog = useCallback((direction: "SEND" | "RECV", type: string, message: any) => {
    const log: DebugLog = {
      timestamp: new Date().toISOString(),
      direction,
      type,
      message,
    };
    setDebugLogs((prev) => [...prev, log]);
  }, []);

  /**
   * Clear debug logs
   */
  const clearLogs = useCallback(() => {
    setDebugLogs([]);
  }, []);

  /**
   * Send message via DataChannel
   */
  const sendMessage = useCallback((message: Message) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.error("Cannot send message - DataChannel not open");
      return;
    }

    try {
      const jsonMessage = JSON.stringify(message);
      dataChannelRef.current.send(jsonMessage);

      // Log non-audio messages
      if (message.type !== "input_audio_buffer.append") {
        addLog("SEND", message.type, message);
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }, [addLog]);

  /**
   * Set up peer connection
   */
  const setupPeerConnection = useCallback(() => {
    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }, // Backup STUN server
    ];

    // Add TURN servers if enabled (only needed for restrictive corporate firewalls)
    if (ENABLE_TURN) {
      iceServers.push({
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      });
      iceServers.push({
        urls: "turns:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      });
      console.log("⚠️  TURN servers enabled (may cause slow connection)");
    }

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: "all", // Use all candidates
      iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
    });

    peerConnectionRef.current = pc;

    // Handle ICE candidates
    pc.onicecandidate = () => {
      if (signalingWsRef.current?.readyState === WebSocket.OPEN) {
        // Note: ICE candidates are sent automatically
        // console.log("📤 ICE candidate generated");
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[${getTimestamp()}] 🔌 Connection state: ${pc.connectionState}`);

      if (pc.connectionState === "connected") {
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionQuality("good");
      } else if (pc.connectionState === "connecting" || pc.connectionState === "new") {
        setIsConnected(false);
        setIsConnecting(true);
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        setIsConnected(false);
        setIsConnecting(false);
        setConnectionQuality("unknown");
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`[${getTimestamp()}] 🧊 ICE connection state: ${pc.iceConnectionState}`);
    };

    // Handle incoming tracks (audio from server)
    pc.ontrack = () => {
      console.log(`[${getTimestamp()}] 🎵 Received audio track from server`);
      // Audio track can be used for playback if needed
      // For now, we'll use DataChannel for audio data
    };

    // Handle DataChannel from server
    pc.ondatachannel = (event) => {
      console.log(`[${getTimestamp()}] 📡 DataChannel received from server`);
      dataChannelRef.current = event.channel;
      setupDataChannel();
    };

    return pc;
  }, []);

  /**
   * Set up DataChannel handlers
   */
  const setupDataChannel = useCallback(() => {
    const dc = dataChannelRef.current;
    if (!dc) return;

    dc.onopen = () => {
      console.log(`[${getTimestamp()}] ✅ DataChannel opened`);
      // Immediately update UI state when DataChannel is ready
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionQuality("good");
    };

    dc.onclose = () => {
      console.log(`[${getTimestamp()}] ❌ DataChannel closed`);
      setIsConnected(false);
      setIsConnecting(false);
    };

    dc.onerror = (error) => {
      console.error("❌ DataChannel error:", error);
    };

    dc.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Message;

        // Log non-audio messages
        if (
          message.type !== "response.output_audio.delta" &&
          message.type !== "input_audio_buffer.append"
        ) {
          addLog("RECV", message.type, message);
        }

        // Forward to message handler
        onMessage(message);
      } catch (error) {
        console.error("Error processing DataChannel message:", error);
      }
    };
  }, [onMessage, addLog]);

  /**
   * Connect to server
   */
  const connect = useCallback(async (sampleRate: number) => {
    try {
      // Set connecting state
      setIsConnecting(true);
      setIsConnected(false);

      // 1. Get ephemeral token first
      console.log(`[${getTimestamp()}] 📝 Getting ephemeral token...`);
      const tokenResponse = await fetch(`${API_BASE_URL}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get ephemeral token: ${tokenResponse.statusText}`);
      }

      const tokenData: SessionResponse = await tokenResponse.json();
      if (tokenData.error) {
        throw new Error(tokenData.error);
      }
      console.log(`[${getTimestamp()}] ✅ Ephemeral token received`);

      // 2. Create session with sample rate
      console.log(`[${getTimestamp()}] 📝 Creating WebRTC session with sample rate: ${sampleRate}Hz`);
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sample_rate: sampleRate,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json();
      sessionIdRef.current = data.session_id;
      console.log(`[${getTimestamp()}] ✅ Session created: ${data.session_id} with ${data.sample_rate}Hz`);

      // 2. Set up peer connection
      const pc = setupPeerConnection();

      // 3. Create DataChannel
      const dc = pc.createDataChannel("xai-voice", {
        ordered: true,
      });
      dataChannelRef.current = dc;
      setupDataChannel();
      console.log(`[${getTimestamp()}] 📡 DataChannel created`);

      // 4. Connect to signaling WebSocket
      const signalingUrl = `${API_BASE_URL.replace("http", "ws")}/signaling/${data.session_id}`;
      console.log(`[${getTimestamp()}] 🔌 Connecting to signaling: ${signalingUrl}`);

      const ws = new WebSocket(signalingUrl);
      signalingWsRef.current = ws;

      return new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log(`[${getTimestamp()}] ✅ Signaling WebSocket connected`);
        };

        ws.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);

            switch (message.type) {
              case "offer":
                console.log(`[${getTimestamp()}] 📥 Offer received from server`);
                // Set remote description
                await pc.setRemoteDescription({
                  type: "offer",
                  sdp: message.sdp,
                });

                // Create answer
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                // Send answer back to server
                ws.send(
                  JSON.stringify({
                    type: "answer",
                    sdp: answer.sdp,
                  })
                );
                console.log(`[${getTimestamp()}] 📤 Answer sent to server`);
                break;

              case "ready":
                console.log(`[${getTimestamp()}] ✅ WebRTC connection ready`);
                // Connection state will be updated by onconnectionstatechange
                resolve();
                break;

              case "error":
                console.error("❌ Signaling error:", message.message);
                reject(new Error(message.message));
                break;
            }
          } catch (error) {
            console.error("❌ Error processing signaling message:", error);
            reject(error);
          }
        };

        ws.onerror = (error) => {
          console.error("❌ Signaling WebSocket error:", error);
          reject(error);
        };

        ws.onclose = () => {
          console.log("❌ Signaling WebSocket closed");
        };
      });
    } catch (error) {
      console.error("❌ Failed to connect:", error);
      throw error;
    }
  }, [setupPeerConnection, setupDataChannel]);

  /**
   * Disconnect from server
   */
  const disconnect = useCallback(() => {
    console.log(`[${getTimestamp()}] 🔌 Disconnecting...`);

    // Close DataChannel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close signaling WebSocket
    if (signalingWsRef.current) {
      signalingWsRef.current.close();
      signalingWsRef.current = null;
    }

    // Delete session
    if (sessionIdRef.current) {
      fetch(`${API_BASE_URL}/sessions/${sessionIdRef.current}`, {
        method: "DELETE",
      }).catch(console.error);
      sessionIdRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setConnectionQuality("unknown");
    console.log(`[${getTimestamp()}] ✅ Disconnected`);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Monitor connection quality
  useEffect(() => {
    if (!isConnected || !peerConnectionRef.current) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const pc = peerConnectionRef.current;
        if (!pc) return;

        const stats = await pc.getStats();
        let totalPacketLoss = 0;
        let jitter = 0;

        stats.forEach((report: any) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            totalPacketLoss = report.packetsLost || 0;
            jitter = report.jitter || 0;
          }
        });

        // Determine connection quality
        if (totalPacketLoss < 10 && jitter < 0.03) {
          setConnectionQuality("excellent");
        } else if (totalPacketLoss < 50 && jitter < 0.05) {
          setConnectionQuality("good");
        } else if (totalPacketLoss < 100 && jitter < 0.1) {
          setConnectionQuality("fair");
        } else {
          setConnectionQuality("poor");
        }
      } catch (error) {
        // Ignore stats errors
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendMessage,
    debugLogs,
    clearLogs,
    provider,
    connectionQuality,
    peerConnection: peerConnectionRef.current,
  };
}

