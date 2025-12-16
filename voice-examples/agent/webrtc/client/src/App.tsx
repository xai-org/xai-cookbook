/**
 * Main App component
 */

import { useState, useCallback, useRef } from "react";
import { TopBar } from "./components/TopBar";
import { ControlPanel } from "./components/ControlPanel";
import { DebugConsole } from "./components/DebugConsole";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useWebRTC } from "./hooks/useWebRTC";
import { useWebRTCStats } from "./hooks/useWebRTCStats";
import { useAudioStream } from "./hooks/useAudioStream";
import type { Message, TranscriptEntry } from "./types/messages";

function App() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const currentTranscriptRef = useRef<{ role: "user" | "assistant"; content: string } | null>(null);
  const sendMessageRef = useRef<((message: Message) => void) | null>(null);

  const { isCapturing, startCapture, stopCapture, stopPlayback, playAudio, audioLevel, sampleRate } =
    useAudioStream();

  // Store callback to start audio capture (used when XAI is ready)
  const startCaptureRef = useRef<((onAudioData: (base64Audio: string) => void) => void) | null>(null);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message: Message) => {
    // Handle XAI ready signal - start capturing audio now
    if (message.type === "xai.ready") {
      console.log("🎤 XAI is ready - starting audio capture");
      if (startCaptureRef.current && sendMessageRef.current) {
        startCaptureRef.current((base64Audio) => {
          sendMessageRef.current?.({
            type: "input_audio_buffer.append",
            audio: base64Audio,
          });
        });
        startCaptureRef.current = null; // Clear the ref after starting
      }
      return;
    }

    // Handle bot audio
    if (message.type === "response.output_audio.delta" && "delta" in message) {
      playAudio(message.delta as string);
    }

    // Handle bot transcript
    if (message.type === "response.output_audio_transcript.delta" && "delta" in message) {
      const delta = message.delta as string;

      if (currentTranscriptRef.current?.role === "assistant") {
        currentTranscriptRef.current.content += delta;
        // Update transcript in place
        setTranscript((prev) => {
          const newTranscript = [...prev];
          if (newTranscript.length > 0) {
            newTranscript[newTranscript.length - 1].content = currentTranscriptRef.current!.content;
          }
          return newTranscript;
        });
      } else {
        // New assistant message
        currentTranscriptRef.current = {
          role: "assistant",
          content: delta,
        };
        setTranscript((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            role: "assistant",
            content: delta,
          },
        ]);
      }
    }

    // Handle response done (assistant finished speaking)
    if (message.type === "response.done") {
      currentTranscriptRef.current = null;
    }

    // Handle user speech started (interruption)
    if (message.type === "input_audio_buffer.speech_started") {
      // Stop any currently playing audio when user interrupts
      stopPlayback();
      console.log("🛑 User interrupted - stopping playback");

      currentTranscriptRef.current = {
        role: "user",
        content: "",
      };

      // Add a user entry immediately (will be updated with transcript)
      // Only add if the last entry isn't already a user entry (avoid duplicates)
      setTranscript((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === "user") {
          // Already have a user entry, don't add another
          return prev;
        }
        return [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            role: "user",
            content: "...",
          },
        ];
      });
    }

    // Handle input audio transcript (user speech)
    if (message.type === "input_audio_buffer.committed") {
      // User finished speaking - we'll get transcript in conversation.item.added
      currentTranscriptRef.current = null;
    }

    // Handle conversation item created (contains user transcript)
    // Consolidate all user transcripts into a single bubble until assistant responds
    if (message.type === "conversation.item.added" && "item" in message) {
      const item = message.item as any;
      if (item.role === "user" && item.content) {
        for (const content of item.content) {
          if (content.type === "input_audio" && content.transcript) {
            setTranscript((prev) => {
              // If the last entry is from user, ALWAYS update it (consolidate until assistant responds)
              if (prev.length > 0 && prev[prev.length - 1].role === "user") {
                const newTranscript = [...prev];
                const lastEntry = newTranscript[newTranscript.length - 1];
                // Append new transcript to existing content (separated by space if not placeholder)
                const existingContent = lastEntry.content === "..." ? "" : lastEntry.content + " ";
                newTranscript[newTranscript.length - 1] = {
                  ...lastEntry,
                  content: existingContent + content.transcript,
                };
                return newTranscript;
              }
              // Otherwise add a new user entry
              return [
                ...prev,
                {
                  timestamp: new Date().toISOString(),
                  role: "user",
                  content: content.transcript,
                },
              ];
            });
            // Only process the first transcript content, break after
            break;
          }
        }
      }
    }
  }, [playAudio, stopPlayback]);

  const {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendMessage,
    debugLogs,
    clearLogs,
    provider,
    connectionQuality,
    peerConnection,
  } = useWebRTC(handleMessage);

  // Collect WebRTC statistics
  const webrtcStats = useWebRTCStats(peerConnection, isConnected);

  // Store sendMessage in ref to avoid circular dependency
  sendMessageRef.current = sendMessage;

  // Start conversation
  const handleStart = async () => {
    try {
      // Clear logs and transcript
      clearLogs();
      setTranscript([]);
      currentTranscriptRef.current = null;

      // Initialize audio context to detect sample rate (but don't start capturing yet)
      const audioContext = new AudioContext();
      const detectedSampleRate = audioContext.sampleRate;
      console.log(`Detected native sample rate: ${detectedSampleRate}Hz`);

      // Store the startCapture function to be called when XAI is ready
      startCaptureRef.current = startCapture;

      // Connect WebRTC with the detected sample rate
      // Audio capture will start automatically when server sends "xai.ready" message
      console.log(`Connecting with ${detectedSampleRate}Hz, audio capture will start when XAI is ready...`);
      await connect(detectedSampleRate);
    } catch (error) {
      console.error("Failed to start:", error);
      alert(`Failed to start: ${error}`);
    }
  };

  // Stop conversation
  const handleStop = () => {
    stopCapture();
    stopPlayback(); // Stop any playing audio
    disconnect();
    // Note: Transcript is preserved and only cleared on next start
  };

  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#fff",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "1rem 1rem 0 1rem" }}>
        <TopBar isConnected={isConnected} isConnecting={isConnecting} provider={provider} connectionQuality={connectionQuality} />
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "auto 1fr",
          gap: "1rem",
          padding: "1rem",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Controls and WebRTC Stats - spans first row */}
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {/* Control Panel */}
          <ControlPanel
            isConnected={isConnected}
            isConnecting={isConnecting}
            isCapturing={isCapturing}
            onStart={handleStart}
            onStop={handleStop}
            audioLevel={audioLevel}
          />

          {/* WebRTC Stats Panel */}
          <div
            style={{
              backgroundColor: "#000",
              color: "#fff",
              border: "2px solid #fff",
              padding: "1.5rem",
            }}
          >
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.2rem" }}>WebRTC Stats</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", fontSize: "0.85rem" }}>
              {/* Column 1 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Connection Quality</span>
                  <span style={{ color: connectionQuality === "excellent" ? "#00ff00" : connectionQuality === "good" ? "#90ee90" : connectionQuality === "fair" ? "#ffff00" : connectionQuality === "poor" ? "#ff0000" : "#888", fontWeight: "600" }}>
                    {connectionQuality.charAt(0).toUpperCase() + connectionQuality.slice(1)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Connection State</span>
                  <span style={{ color: "#0ff" }}>{webrtcStats.connectionState}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>ICE State</span>
                  <span style={{ color: "#0ff" }}>{webrtcStats.iceConnectionState}</span>
                </div>
              </div>

              {/* Column 2 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Audio In</span>
                  <span style={{ color: "#0f0", fontFamily: "monospace" }}>
                    {webrtcStats.bitrate.audio_in === 0 ? "0 bps" : webrtcStats.bitrate.audio_in < 1000 ? `${webrtcStats.bitrate.audio_in} bps` : webrtcStats.bitrate.audio_in < 1000000 ? `${(webrtcStats.bitrate.audio_in / 1000).toFixed(1)} kbps` : `${(webrtcStats.bitrate.audio_in / 1000000).toFixed(2)} Mbps`}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Audio Out</span>
                  <span style={{ color: "#0f0", fontFamily: "monospace" }}>
                    {webrtcStats.bitrate.audio_out === 0 ? "0 bps" : webrtcStats.bitrate.audio_out < 1000 ? `${webrtcStats.bitrate.audio_out} bps` : webrtcStats.bitrate.audio_out < 1000000 ? `${(webrtcStats.bitrate.audio_out / 1000).toFixed(1)} kbps` : `${(webrtcStats.bitrate.audio_out / 1000000).toFixed(2)} Mbps`}
                  </span>
                </div>
              </div>

              {/* Column 3 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Jitter</span>
                  <span style={{ color: "#ff0", fontFamily: "monospace" }}>
                    {webrtcStats.jitter.toFixed(2)} ms
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Packet Loss</span>
                  <span style={{ color: webrtcStats.packetLoss > 50 ? "#f00" : "#ff0", fontFamily: "monospace" }}>
                    {webrtcStats.packetLoss} pkts
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#aaa" }}>Round Trip Time</span>
                  <span style={{ color: "#ff0", fontFamily: "monospace" }}>
                    {webrtcStats.rtt} ms
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transcript Panel - left column */}
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <TranscriptPanel transcript={transcript} />
        </div>

        {/* Debug Console - right column */}
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <DebugConsole logs={debugLogs} />
        </div>
      </div>
    </div>
  );
}

export default App;
