/**
 * WebSocket connection hook
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message, DebugLogEntry } from "../types/messages";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: Message) => void;
  debugLogs: DebugLogEntry[];
  clearLogs: () => void;
  provider: string | null;
}

export function useWebSocket(
  onMessage: (message: Message) => void
): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

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

  const connect = useCallback(async () => {
    try {
      // Create session
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json();
      sessionIdRef.current = data.session_id;

      // Get provider info from health check
      const healthResponse = await fetch(`${API_BASE_URL}/health`);
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setProvider(healthData.provider || "Unknown");
      }

      // Connect WebSocket
      const wsUrl = `${API_BASE_URL.replace("http", "ws")}/ws/${data.session_id}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data);
          addDebugLog("RECV", message);
          onMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        setIsConnected(false);
        wsRef.current = null;
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("Failed to connect:", error);
      throw error;
    }
  }, [onMessage, addDebugLog]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback(
    (message: Message) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
        addDebugLog("SEND", message);
      } else {
        console.error("WebSocket not connected");
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

