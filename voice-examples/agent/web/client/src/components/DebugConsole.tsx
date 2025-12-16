/**
 * DebugConsole component - Display WebSocket messages (excluding audio)
 */

import React, { useEffect, useRef } from "react";
import type { DebugLogEntry } from "../types/messages";

interface DebugConsoleProps {
  logs: DebugLogEntry[];
}

export const DebugConsole: React.FC<DebugConsoleProps> = ({ logs }) => {
  const consoleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#fff",
        border: "2px solid #fff",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.2rem" }}>Debug Console</h2>
      
      <div
        ref={consoleRef}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "monospace",
          fontSize: "0.85rem",
          lineHeight: "1.4",
          backgroundColor: "#000",
          border: "1px solid #fff",
          padding: "0.5rem",
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: "#666" }}>No messages yet...</div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              style={{
                marginBottom: "0.5rem",
                paddingBottom: "0.5rem",
                borderBottom: "1px solid #333",
              }}
            >
              <div style={{ color: log.direction === "SEND" ? "#ffff00" : "#00ffff" }}>
                [{formatTime(log.timestamp)}] {log.direction} → {log.type}
              </div>
              <div
                style={{
                  marginLeft: "1rem",
                  marginTop: "0.25rem",
                  color: "#aaa",
                  fontSize: "0.8rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(log.message, null, 2)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

