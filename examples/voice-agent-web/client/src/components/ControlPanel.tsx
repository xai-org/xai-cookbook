/**
 * ControlPanel component - Start/Stop controls and session status
 */

import React from "react";

interface ControlPanelProps {
  isConnected: boolean;
  isCapturing: boolean;
  onStart: () => void;
  onStop: () => void;
  audioLevel: number;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  isConnected,
  isCapturing,
  onStart,
  onStop,
  audioLevel,
}) => {
  const disabled = isConnected && isCapturing;

  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#fff",
        border: "2px solid #fff",
        padding: "1.5rem",
      }}
    >
      <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.2rem" }}>Controls</h2>
      
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <button
          onClick={onStart}
          disabled={disabled}
          style={{
            backgroundColor: "#000",
            color: disabled ? "#666" : "#00ff00",
            border: `2px solid ${disabled ? "#666" : "#00ff00"}`,
            padding: "0.75rem 2rem",
            fontSize: "1rem",
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          START
        </button>
        
        <button
          onClick={onStop}
          disabled={!isConnected}
          style={{
            backgroundColor: "#000",
            color: !isConnected ? "#666" : "#ff0000",
            border: `2px solid ${!isConnected ? "#666" : "#ff0000"}`,
            padding: "0.75rem 2rem",
            fontSize: "1rem",
            cursor: !isConnected ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          STOP
        </button>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <div style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>
          <strong>Status:</strong>{" "}
          {isConnected
            ? isCapturing
              ? "Recording"
              : "Connected (waiting)"
            : "Not connected"}
        </div>
        
        {isCapturing && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              <strong>Microphone Level:</strong>
            </div>
            <div
              style={{
                width: "100%",
                height: "20px",
                border: "1px solid #fff",
                backgroundColor: "#000",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, audioLevel * 500)}%`,
                  height: "100%",
                  backgroundColor: "#00ff00",
                  transition: "width 0.1s",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

