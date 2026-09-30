/**
 * TopBar component - Header with title, connection status, and provider info
 */

import React from "react";

interface TopBarProps {
  isConnected: boolean;
  isConnecting?: boolean;
  provider: string | null;
  connectionQuality?: "excellent" | "good" | "fair" | "poor" | "unknown";
}

export const TopBar: React.FC<TopBarProps> = ({ isConnected, isConnecting = false, provider, connectionQuality = "unknown" }) => {
  const getQualityColor = () => {
    switch (connectionQuality) {
      case "excellent":
        return "#00ff00";
      case "good":
        return "#90ee90";
      case "fair":
        return "#ffff00";
      case "poor":
        return "#ff0000";
      default:
        return "#888";
    }
  };
  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#fff",
        border: "2px solid #fff",
        padding: "1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: "bold" }}>
        XAI Voice Demo
      </h1>
      
      <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
        {provider && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.9rem" }}>Protocol:</span>
            <span style={{ fontWeight: "bold", color: "#00bfff" }}>{provider}</span>
          </div>
        )}
        
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: isConnected ? getQualityColor() : isConnecting ? "#ffaa00" : "#ff0000",
            }}
          />
          <span style={{ fontSize: "0.9rem" }}>
            {isConnected ? `Connected (${connectionQuality})` : isConnecting ? "Connecting..." : "Disconnected"}
          </span>
        </div>
      </div>
    </div>
  );
};

