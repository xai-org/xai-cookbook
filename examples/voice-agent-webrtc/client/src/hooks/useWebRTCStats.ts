/**
 * WebRTC Stats Hook
 * Collects and provides WebRTC connection statistics
 */

import { useState, useEffect } from "react";

export interface WebRTCStats {
  bitrate: {
    audio_in: number;
    audio_out: number;
  };
  jitter: number;
  packetLoss: number;
  connectionState: string;
  iceConnectionState: string;
  rtt: number; // Round trip time
}

export function useWebRTCStats(
  peerConnection: RTCPeerConnection | null,
  isConnected: boolean
): WebRTCStats {
  const [stats, setStats] = useState<WebRTCStats>({
    bitrate: { audio_in: 0, audio_out: 0 },
    jitter: 0,
    packetLoss: 0,
    connectionState: "new",
    iceConnectionState: "new",
    rtt: 0,
  });

  useEffect(() => {
    // Reset stats when disconnected
    if (!peerConnection || !isConnected) {
      setStats({
        bitrate: { audio_in: 0, audio_out: 0 },
        jitter: 0,
        packetLoss: 0,
        connectionState: peerConnection?.connectionState || "disconnected",
        iceConnectionState: peerConnection?.iceConnectionState || "disconnected",
        rtt: 0,
      });
      return;
    }

    let previousBytesReceived = 0;
    let previousBytesSent = 0;
    let previousTimestamp = Date.now();

    const interval = setInterval(async () => {
      try {
        const reports = await peerConnection.getStats();
        const currentTimestamp = Date.now();
        const timeDelta = (currentTimestamp - previousTimestamp) / 1000; // seconds

        let bytesReceived = 0;
        let bytesSent = 0;
        let jitter = 0;
        let packetsLost = 0;
        let rtt = 0;

        reports.forEach((report: any) => {
          // DataChannel stats (for DataChannel-based audio)
          if (report.type === "data-channel") {
            bytesReceived = report.bytesReceived || 0;
            bytesSent = report.bytesSent || 0;
          }

          // Transport stats (alternative source for bytes)
          if (report.type === "transport") {
            if (!bytesReceived && report.bytesReceived) {
              bytesReceived = report.bytesReceived;
            }
            if (!bytesSent && report.bytesSent) {
              bytesSent = report.bytesSent;
            }
          }

          // Candidate pair (for RTT, jitter, and packet loss)
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0; // Convert to ms
            // Note: jitter and packet loss are typically only available for RTP streams
            // For DataChannel, we can estimate from transport stats if available
            packetsLost = report.packetsLost || 0;
          }

          // Inbound RTP (fallback if any audio tracks are used)
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            if (!bytesReceived) bytesReceived = report.bytesReceived || 0;
            jitter = report.jitter || 0;
            packetsLost = report.packetsLost || 0;
          }

          // Outbound RTP (fallback if any audio tracks are used)
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            if (!bytesSent) bytesSent = report.bytesSent || 0;
          }
        });

        // Calculate bitrates (bits per second)
        const bitrateIn =
          previousBytesReceived > 0
            ? ((bytesReceived - previousBytesReceived) * 8) / timeDelta
            : 0;
        const bitrateOut =
          previousBytesSent > 0
            ? ((bytesSent - previousBytesSent) * 8) / timeDelta
            : 0;

        previousBytesReceived = bytesReceived;
        previousBytesSent = bytesSent;
        previousTimestamp = currentTimestamp;

        setStats({
          bitrate: {
            audio_in: Math.round(bitrateIn),
            audio_out: Math.round(bitrateOut),
          },
          jitter: Math.round(jitter * 1000 * 100) / 100, // Convert to ms
          packetLoss: packetsLost,
          connectionState: peerConnection.connectionState,
          iceConnectionState: peerConnection.iceConnectionState,
          rtt: Math.round(rtt),
        });
      } catch (error) {
        console.error("Error collecting WebRTC stats:", error);
      }
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [peerConnection, isConnected]);

  return stats;
}

