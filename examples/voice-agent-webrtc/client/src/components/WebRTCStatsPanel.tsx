/**
 * WebRTC Stats Panel Component
 * Displays connection quality and statistics
 */

import type { WebRTCStats } from "../hooks/useWebRTCStats";

interface WebRTCStatsPanelProps {
  stats: WebRTCStats;
  connectionQuality: "excellent" | "good" | "fair" | "poor" | "unknown";
}

export function WebRTCStatsPanel({ stats, connectionQuality }: WebRTCStatsPanelProps) {
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

  const getQualityLabel = () => {
    return connectionQuality.charAt(0).toUpperCase() + connectionQuality.slice(1);
  };

  const formatBitrate = (bitrate: number): string => {
    if (bitrate === 0) return "0 bps";
    if (bitrate < 1000) return `${bitrate} bps`;
    if (bitrate < 1000000) return `${(bitrate / 1000).toFixed(1)} kbps`;
    return `${(bitrate / 1000000).toFixed(2)} Mbps`;
  };

  return (
    <div
      style={{
        backgroundColor: "#111",
        border: "1px solid #333",
        borderRadius: "8px",
        padding: "1rem",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: "600",
          color: "#fff",
          marginBottom: "0.5rem",
          borderBottom: "1px solid #333",
          paddingBottom: "0.5rem",
        }}
      >
        📊 WebRTC Stats
      </div>

      {/* Connection Quality */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Connection Quality</span>
        <span
          style={{
            color: getQualityColor(),
            fontWeight: "600",
            fontSize: "0.95rem",
          }}
        >
          {getQualityLabel()}
        </span>
      </div>

      {/* Connection State */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Connection State</span>
        <span style={{ color: "#0ff", fontSize: "0.9rem" }}>{stats.connectionState}</span>
      </div>

      {/* ICE State */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>ICE State</span>
        <span style={{ color: "#0ff", fontSize: "0.9rem" }}>{stats.iceConnectionState}</span>
      </div>

      <div style={{ borderTop: "1px solid #333", margin: "0.5rem 0" }} />

      {/* Audio Bitrate In */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Audio In</span>
        <span style={{ color: "#0f0", fontSize: "0.9rem", fontFamily: "monospace" }}>
          {formatBitrate(stats.bitrate.audio_in)}
        </span>
      </div>

      {/* Audio Bitrate Out */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Audio Out</span>
        <span style={{ color: "#0f0", fontSize: "0.9rem", fontFamily: "monospace" }}>
          {formatBitrate(stats.bitrate.audio_out)}
        </span>
      </div>

      <div style={{ borderTop: "1px solid #333", margin: "0.5rem 0" }} />

      {/* Jitter */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Jitter</span>
        <span style={{ color: "#ff0", fontSize: "0.9rem", fontFamily: "monospace" }}>
          {stats.jitter.toFixed(2)} ms
        </span>
      </div>

      {/* Packet Loss */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Packet Loss</span>
        <span
          style={{
            color: stats.packetLoss > 50 ? "#f00" : "#ff0",
            fontSize: "0.9rem",
            fontFamily: "monospace",
          }}
        >
          {stats.packetLoss} pkts
        </span>
      </div>

      {/* RTT (Round Trip Time) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#aaa", fontSize: "0.9rem" }}>Round Trip Time</span>
        <span style={{ color: "#ff0", fontSize: "0.9rem", fontFamily: "monospace" }}>
          {stats.rtt} ms
        </span>
      </div>
    </div>
  );
}

