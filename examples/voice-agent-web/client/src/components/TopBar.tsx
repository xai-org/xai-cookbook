/**
 * TopBar component - Header with title, connection status, and provider info
 */

import React from "react";

interface TopBarProps {
  isConnected: boolean;
  provider: string | null;
}

export const TopBar: React.FC<TopBarProps> = ({ isConnected, provider }) => {
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
            <span style={{ fontSize: "0.9rem" }}>Provider:</span>
            <span style={{ fontWeight: "bold" }}>{provider}</span>
          </div>
        )}
        
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: isConnected ? "#00ff00" : "#ff0000",
            }}
          />
          <span style={{ fontSize: "0.9rem" }}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </div>
  );
};

