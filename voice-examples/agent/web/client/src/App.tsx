/**
 * Main App component
 */

import { useState, useCallback, useRef } from "react";
import { TopBar } from "./components/TopBar";
import { ControlPanel } from "./components/ControlPanel";
import { DebugConsole } from "./components/DebugConsole";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioStream } from "./hooks/useAudioStream";
import type { Message, TranscriptEntry } from "./types/messages";

function App() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const currentTranscriptRef = useRef<{ role: "user" | "assistant"; content: string } | null>(null);
  const sendMessageRef = useRef<((message: Message) => void) | null>(null);

  const { isCapturing, startCapture, stopCapture, stopPlayback, playAudio, audioLevel } =
    useAudioStream();

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message: Message) => {
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

      currentTranscriptRef.current = {
        role: "user",
        content: "",
      };

      // Add a user entry immediately (will be updated with transcript)
      // Only add if the last entry isn't already a user entry (avoid duplicates from multiple speech_started events)
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
    connect,
    disconnect,
    sendMessage,
    debugLogs,
    clearLogs,
    provider,
  } = useWebSocket(handleMessage);

  // Store sendMessage in ref to avoid circular dependency
  sendMessageRef.current = sendMessage;

  // Start conversation
  const handleStart = async () => {
    try {
      // Clear logs and transcript
      clearLogs();
      setTranscript([]);
      currentTranscriptRef.current = null;

      // Start audio capture first to get sample rate (returns the detected rate)
      const detectedSampleRate = await startCapture((base64Audio) => {
        sendMessage({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        });
      });

      // Connect WebSocket with the detected sample rate
      console.log(`Using detected sample rate: ${detectedSampleRate}Hz`);
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
    setTranscript([]);
    currentTranscriptRef.current = null;
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
        <TopBar isConnected={isConnected} provider={provider} />
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
        {/* Control Panel - spans first row */}
        <div style={{ gridColumn: "1 / -1" }}>
          <ControlPanel
            isConnected={isConnected}
            isCapturing={isCapturing}
            onStart={handleStart}
            onStop={handleStop}
            audioLevel={audioLevel}
          />
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
