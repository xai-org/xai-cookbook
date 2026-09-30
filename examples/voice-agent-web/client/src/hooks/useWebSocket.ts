/**
 * WebSocket connection hook using ephemeral tokens
 * Connects directly to XAI's realtime API
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message, DebugLogEntry } from "../types/messages";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: (sampleRate: number) => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: Message) => void;
  debugLogs: DebugLogEntry[];
  clearLogs: () => void;
  provider: string | null;
}

interface SessionResponse {
  client_secret: {
    value: string;
    expires_at: number;
  };
  voice: string;
  instructions: string;
  error?: string;
}

export function useWebSocket(
  onMessage: (message: Message) => void
): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionConfigRef = useRef<{ voice: string; instructions: string; sampleRate: number } | null>(null);
  const isSessionConfigured = useRef(false);

  const addDebugLog = useCallback((direction: "SEND" | "RECV", message: Message) => {
    // Skip audio messages
    if (
      message.type === "input_audio_buffer.append" ||
      message.type === "response.output_audio.delta"
    ) {
      return;
    }

    const log: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      direction,
      type: message.type,
      message,
    };

    setDebugLogs((prev) => [...prev, log]);
  }, []);

  const clearLogs = useCallback(() => {
    setDebugLogs([]);
  }, []);

  /**
   * Configure the XAI session after connection
   */
  const configureSession = useCallback((ws: WebSocket) => {
    if (!sessionConfigRef.current) return;

    const { voice, instructions, sampleRate } = sessionConfigRef.current;

    console.log(`⚙️ Configuring session with ${sampleRate}Hz audio...`);

    const sessionConfig = {
      type: "session.update",
      session: {
        instructions,
        voice,
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
        },
        turn_detection: {
          type: "server_vad",
        },
      },
    };

    ws.send(JSON.stringify(sessionConfig));
    addDebugLog("SEND", sessionConfig as Message);
  }, [addDebugLog]);

  /**
   * Send initial greeting after session is configured
   */
  const sendInitialGreeting = useCallback((ws: WebSocket) => {
    console.log("🎤 Session configured, sending initial greeting...");

    // Commit any pending audio buffer
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    // Create greeting message
    const greetingMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Say hello and introduce yourself",
          },
        ],
      },
    };
    ws.send(JSON.stringify(greetingMessage));
    addDebugLog("SEND", greetingMessage as Message);

    // Request response
    ws.send(JSON.stringify({ type: "response.create" }));

    console.log("🎤 Ready for voice interaction");
  }, [addDebugLog]);

  const connect = useCallback(async (sampleRate: number) => {
    try {
      console.log(`📝 Getting ephemeral token...`);

      // Get ephemeral token from backend
      const response = await fetch(`${API_BASE_URL}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get session: ${response.statusText}`);
      }

      const data: SessionResponse = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const ephemeralToken = data.client_secret.value;
      console.log(`✅ Ephemeral token received, expires at: ${new Date(data.client_secret.expires_at * 1000).toISOString()}`);

      // Store session config for later use
      sessionConfigRef.current = {
        voice: data.voice,
        instructions: data.instructions,
        sampleRate,
      };
      isSessionConfigured.current = false;

      // Get provider info from health check
      try {
        const healthResponse = await fetch(`${API_BASE_URL}/health`);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          setProvider(healthData.provider || "XAI");
        }
      } catch {
        setProvider("XAI");
      }

      // Connect directly to XAI API with ephemeral token
      console.log(`🔌 Connecting to XAI API: ${XAI_REALTIME_URL}`);
      const ws = new WebSocket(XAI_REALTIME_URL, [
        "realtime",
        `openai-insecure-api-key.${ephemeralToken}`,
        "openai-beta.realtime-v1",
      ]);

      ws.onopen = () => {
        console.log("✅ WebSocket connected to XAI API");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data);
          addDebugLog("RECV", message);

          // Handle conversation.created - configure session
          if (message.type === "conversation.created" && !isSessionConfigured.current) {
            console.log("📞 Conversation created, configuring session...");
            configureSession(ws);
          }

          // Handle session.updated - send initial greeting
          if (message.type === "session.updated" && !isSessionConfigured.current) {
            isSessionConfigured.current = true;
            sendInitialGreeting(ws);
          }

          onMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
      };

      ws.onclose = (event) => {
        console.log(`❌ WebSocket closed - Code: ${event.code}, Reason: ${event.reason || "No reason"}`);
        setIsConnected(false);
        wsRef.current = null;
        isSessionConfigured.current = false;
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("❌ Failed to connect:", error);
      throw error;
    }
  }, [onMessage, addDebugLog, configureSession, sendInitialGreeting]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    isSessionConfigured.current = false;
  }, []);

  const sendMessage = useCallback(
    (message: Message) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Drop audio messages until session is configured
        if (message.type === "input_audio_buffer.append" && !isSessionConfigured.current) {
          return;
        }

        wsRef.current.send(JSON.stringify(message));
        addDebugLog("SEND", message);
      } else {
        // Silently drop audio messages before connection - this is expected during startup
        if (message.type !== "input_audio_buffer.append") {
          console.error("WebSocket not connected");
        }
      }
    },
    [addDebugLog]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    isConnected,
    connect,
    disconnect,
    sendMessage,
    debugLogs,
    clearLogs,
    provider,
  };
}
