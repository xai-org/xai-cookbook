/**
 * XAI API WebSocket client
 * Handles communication with XAI's realtime voice API
 */

import WebSocket from "ws";
import type { XAIMessage } from "./types";

export interface XAIClientConfig {
  apiKey: string;
  apiUrl: string;
  voice: string;
  instructions: string;
  sessionId: string;
  sampleRate: number;
}

export type XAIMessageHandler = (message: XAIMessage) => void;
export type XAIErrorHandler = (error: Error) => void;
export type XAICloseHandler = (code: number, reason: string) => void;
export type XAIReadyHandler = () => void;

export class XAIClient {
  private ws: WebSocket | null = null;
  private config: XAIClientConfig;
  private messageHandler: XAIMessageHandler | null = null;
  private errorHandler: XAIErrorHandler | null = null;
  private closeHandler: XAICloseHandler | null = null;
  private onReady: XAIReadyHandler | null = null;
  private isConfigured = false;

  constructor(config: XAIClientConfig) {
    this.config = config;
  }

  /**
   * Connect to XAI API
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { apiKey, apiUrl, sessionId } = this.config;

      console.log(`[${sessionId}] 🔌 Connecting to XAI API: ${apiUrl}`);

      try {
        this.ws = new WebSocket(apiUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        this.ws.on("open", () => {
          console.log(`[${sessionId}] ✅ Connected to XAI API`);
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on("error", (error) => {
          console.error(`[${sessionId}] ❌ XAI WebSocket error:`, error);
          if (this.errorHandler) {
            this.errorHandler(error as Error);
          }
          reject(error);
        });

        this.ws.on("close", (code, reason) => {
          console.log(
            `[${sessionId}] ❌ XAI WebSocket closed - Code: ${code}, Reason: ${reason.toString() || "No reason"}`
          );
          if (this.closeHandler) {
            this.closeHandler(code, reason.toString());
          }
        });
      } catch (error) {
        console.error(`[${sessionId}] ❌ Failed to create XAI WebSocket:`, error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages from XAI API
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as XAIMessage;
      const eventType = message.type;
      const { sessionId } = this.config;

      // Log non-audio events
      if (
        eventType !== "response.output_audio.delta" &&
        eventType !== "input_audio_buffer.append"
      ) {
        console.log(`[${sessionId}] 📥 XAI → Server: ${eventType}`);

        // Log full details for session.updated and error events
        if (eventType === "session.updated") {
          console.log(`[${sessionId}] 🔧 DEBUG: session.updated details:`, JSON.stringify(message, null, 2));

          // After session.updated is confirmed, send initial greeting
          console.log(`[${sessionId}] ✅ Session configuration confirmed, sending initial greeting...`);
          this.sendMessage({ type: "input_audio_buffer.commit" });
          this.sendMessage({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Greet me briefly.",
                },
              ],
            },
          });
          this.sendMessage({ type: "response.create" });
          console.log(`[${sessionId}] 🎤 XAI ready for voice interaction`);

          // Notify client that it's safe to start sending audio
          if (this.onReady) {
            this.onReady();
          }
        }
      }

      // Handle conversation.created - configure session
      if (eventType === "conversation.created" && !this.isConfigured) {
        this.configureSession();
      }

      // Forward message to handler
      if (this.messageHandler) {
        this.messageHandler(message);
      }

      // Handle errors
      if (eventType === "error") {
        const error = (message as any).error || {};
        console.error(`[${sessionId}] ❌ XAI API Error:`, error);
        console.error(`[${sessionId}] 🔧 DEBUG: Full error message:`, JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error(`[${this.config.sessionId}] ❌ Error processing XAI message:`, error);
    }
  }

  /**
   * Configure the XAI session
   */
  private configureSession(): void {
    const { sessionId, voice, instructions, sampleRate } = this.config;

    console.log(`[${sessionId}] ⚙️  Configuring XAI session with ${sampleRate}Hz audio...`);

    // Send session configuration with dynamic sample rate
    const sessionConfig = {
      type: "session.update",
      session: {
        instructions,
        voice,
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
        },
        turn_detection: {
          type: "server_vad",
        },
      },
    };

    console.log(`[${sessionId}] 🔧 DEBUG: Sending session config:`, JSON.stringify(sessionConfig, null, 2));
    this.sendMessage(sessionConfig);
    console.log(`[${sessionId}] ⚙️  Waiting for session.updated confirmation...`);

    // NOTE: Initial greeting will be sent after session.updated is received
    // This prevents mixing audio frame rates (sending audio before config is applied)
    this.isConfigured = true;
  }

  /**
   * Send a message to XAI API
   */
  sendMessage(message: XAIMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(
        `[${this.config.sessionId}] ❌ Cannot send message - WebSocket not open`
      );
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));

      // Log non-audio events
      if (message.type !== "input_audio_buffer.append") {
        console.log(`[${this.config.sessionId}] 📤 Server → XAI: ${message.type}`);
      }
    } catch (error) {
      console.error(
        `[${this.config.sessionId}] ❌ Error sending message to XAI:`,
        error
      );
    }
  }

  /**
   * Set message handler
   */
  onMessage(handler: XAIMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set error handler
   */
  onError(handler: XAIErrorHandler): void {
    this.errorHandler = handler;
  }

  /**
   * Set close handler
   */
  onClose(handler: XAICloseHandler): void {
    this.closeHandler = handler;
  }

  /**
   * Set ready handler (called when XAI session is configured and ready for audio)
   */
  setReadyHandler(handler: XAIReadyHandler): void {
    this.onReady = handler;
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
