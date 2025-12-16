/**
 * TranscriptPanel component - Display conversation transcript
 */

import React, { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../types/messages";

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ transcript }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [transcript]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
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
      <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.2rem" }}>Transcript</h2>
      
      <div
        ref={panelRef}
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: "#000",
          border: "1px solid #fff",
          padding: "0.5rem",
        }}
      >
        {transcript.length === 0 ? (
          <div style={{ color: "#666", fontStyle: "italic" }}>
            Conversation transcript will appear here...
          </div>
        ) : (
          transcript.map((entry, index) => (
            <div
              key={index}
              style={{
                marginBottom: "1rem",
                paddingBottom: "1rem",
                borderBottom: index < transcript.length - 1 ? "1px solid #333" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                <span
                  style={{
                    fontWeight: "bold",
                    color: entry.role === "user" ? "#00ff00" : "#00ffff",
                  }}
                >
                  {entry.role === "user" ? "USER" : "ASSISTANT"}
                </span>
                <span style={{ color: "#666" }}>{formatTime(entry.timestamp)}</span>
              </div>
              <div style={{ lineHeight: "1.5" }}>{entry.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

