import "dotenv-flow/config";
import express from "express";
import ExpressWs from "express-ws";
import * as crypto from "crypto";
import plivo from "plivo";
import bot from "./bot";
import { PlivoAudioStreamWebsocket } from "./plivo";
import { provisionPlivoApplication } from "./provision";

const { app } = ExpressWs(express());
app.use(express.urlencoded({ extended: true })).use(express.json());

// ========================================
// Configuration
// ========================================
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const API_URL = process.env.API_URL || "wss://api.x.ai/v1/realtime";
const ENABLE_TOOLS = process.env.ENABLE_TOOLS !== "false"; // Default: enabled
const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID || "";
const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN || "";
const AUTO_PROVISION = process.env.AUTO_PROVISION !== "false"; // Default: enabled when creds present

function logEvent(callId: string, eventType: string, extra?: string) {
  if (extra) {
    console.log(`[${callId}] ${eventType}`);
    console.log(`  ${extra}`);
  } else {
    console.log(`[${callId}] ${eventType}`);
  }
}

function generateSecureId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function publicHost(hostname: string): string {
  return hostname.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function publicHttpsBase(hostname: string): string {
  const cleaned = hostname.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned.replace(/^http:\/\//, "https://");
  }
  return `https://${cleaned}`;
}

function streamXml(streamUrl: string): string {
  // Plivo Stream XML — mu-law 8 kHz bidirectional, keepCallAlive
  // https://plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-guide
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>
`;
}

function getPlivoClient() {
  if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
    return null;
  }
  return new plivo.Client(PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN);
}

async function hangupCall(callUuid: string): Promise<void> {
  const client = getPlivoClient();
  if (!client) {
    throw new Error("PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN required to hang up");
  }
  await client.calls.hangup(callUuid);
}

// ========================================
// Tool Definitions
// ========================================
const tools = [
  {
    type: "function",
    name: "end_call",
    description: "End the current phone call. Use when the user says goodbye or asks to hang up.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional short reason for ending the call",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "generate_random_number",
    description: "Generate a random number between min and max values",
    parameters: {
      type: "object",
      properties: {
        min: {
          type: "number",
          description: "Minimum value (inclusive)",
        },
        max: {
          type: "number",
          description: "Maximum value (inclusive)",
        },
      },
      required: ["min", "max"],
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, any>,
  ctx: { callUuid?: string },
): Promise<string> {
  switch (name) {
    case "end_call": {
      if (!ctx.callUuid) {
        return JSON.stringify({ error: "No active Plivo call UUID" });
      }
      try {
        await hangupCall(ctx.callUuid);
        return JSON.stringify({ ok: true, reason: args.reason || "user_request" });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    }
    case "generate_random_number": {
      const min = Math.ceil(args.min);
      const max = Math.floor(args.max);
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      return JSON.stringify({ result, min: args.min, max: args.max });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ========================================
// Health Check Endpoint
// ========================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ========================================
// Plivo Voice Webhook Endpoints
// ========================================
// Answer URL — return Stream XML for inbound calls
app.post("/answer", async (req, res) => {
  try {
    const callId = generateSecureId("call");

    if (!process.env.HOSTNAME) {
      res.status(500).send("Server misconfigured: HOSTNAME not set");
      return;
    }

    const hostname = publicHost(process.env.HOSTNAME);
    const streamUrl = `wss://${hostname}/media-stream/${callId}`;

    res.status(200);
    res.type("text/xml");
    res.end(streamXml(streamUrl));
  } catch (error) {
    res.status(500).send();
  }
});

// Hangup / status callback
app.post("/hangup", async (req, res) => {
  const callUuid = req.body?.CallUUID || req.body?.call_uuid;
  if (callUuid) {
    console.log(`[${callUuid}] plivo.hangup`, req.body?.HangupCauseName || "");
  }
  res.status(200).send();
});

app.post("/stream-status", async (req, res) => {
  console.log("[stream-status]", req.body?.Event, req.body?.CallUUID, req.body?.StreamID);
  res.status(200).send();
});

// ========================================
// Plivo Audio Stream Websocket Endpoint
// ========================================
app.ws("/media-stream/:callId", async (ws, req) => {
  const callId = String(req.params.callId);

  console.log(`\n[${callId}] === CALL STARTED ===`);

  const pl = new PlivoAudioStreamWebsocket(ws);

  // Capture start metadata ASAP (before async xAI connect)
  pl.on("start", (msg) => {
    pl.streamId = msg.start.streamId;
    pl.callId = msg.start.callId;
    logEvent(callId, "plivo.start", `streamId=${msg.start.streamId} callId=${msg.start.callId}`);
  });

  const WebSocket = require("ws");
  const xaiWs = new WebSocket(API_URL, {
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  await new Promise((resolve, reject) => {
    const wsTimeout = setTimeout(() => {
      xaiWs.close();
      reject(new Error("x.ai WebSocket connection timeout"));
    }, 10000);

    xaiWs.on("open", () => {
      clearTimeout(wsTimeout);
      logEvent(callId, "websocket.open");
      resolve(null);
    });

    xaiWs.on("error", (error: any) => {
      clearTimeout(wsTimeout);
      reject(error);
    });
  });

  let sessionReady = false;
  let turnCount = 0;
  let turnActive = false;

  xaiWs.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type !== "response.output_audio.delta" && message.type !== "input_audio_buffer.append") {
        logEvent(callId, message.type);
      }

      if (message.type === "response.output_audio.delta" && message.delta) {
        // Bot audio -> Plivo playAudio (mu-law 8 kHz passthrough)
        // https://plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-reference
        if (!pl.streamId) return;
        pl.send({
          event: "playAudio",
          media: {
            contentType: "audio/x-mulaw",
            sampleRate: 8000,
            payload: message.delta,
          },
        });
      } else if (message.type === "response.created") {
        if (turnActive) {
          console.log(`[${callId}] === TURN ${turnCount} INTERRUPTED ===\n`);
        }
        turnCount++;
        turnActive = true;
        console.log(`\n[${callId}] === START TURN ${turnCount} ===`);
      } else if (message.type === "response.done") {
        turnActive = false;
        console.log(`[${callId}] === END TURN ${turnCount} ===\n`);
      } else if (message.type === "response.cancelled") {
        turnActive = false;
        console.log(`[${callId}] === TURN ${turnCount} CANCELLED ===\n`);
      } else if (message.type === "response.output_audio_transcript.delta") {
        console.log(`[${callId}] Bot: "${message.delta}"`);
      } else if (message.type === "session.updated") {
        sessionReady = true;

        const conversationItem = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Say hello and introduce yourself",
              },
            ],
          },
        };
        logEvent(callId, conversationItem.type);
        xaiWs.send(JSON.stringify(conversationItem));

        const responseCreate = { type: "response.create" };
        logEvent(callId, responseCreate.type);
        xaiWs.send(JSON.stringify(responseCreate));
      } else if (message.type === "conversation.created") {
        console.log(`  conversation_id: ${message.conversation?.id || "unknown"}`);

        const sessionConfig = {
          type: "session.update",
          session: {
            instructions: bot.instructions,
            voice: "ara",
            audio: {
              input: { format: { type: "audio/pcmu" } },
              output: { format: { type: "audio/pcmu" } },
            },
            turn_detection: { type: "server_vad" },
            ...(ENABLE_TOOLS ? { tools: tools } : {}),
          },
        };
        logEvent(callId, sessionConfig.type);
        xaiWs.send(JSON.stringify(sessionConfig));
      } else if (message.type === "input_audio_buffer.speech_started") {
        // Barge-in: clear queued bot audio on Plivo
        if (pl.streamId) {
          pl.send({ event: "clearAudio", streamId: pl.streamId });
        }
      } else if (message.type === "error") {
        console.log(`  ERROR: ${message.error?.message || JSON.stringify(message)}`);
      } else if (message.type === "response.output_item.done") {
        if (message.item?.type === "function_call") {
          (async () => {
            const functionName = message.item.name;
            const callId_fn = message.item.call_id;
            let args: Record<string, any> = {};

            try {
              args = JSON.parse(message.item.arguments || "{}");
            } catch (e) {
              // Failed to parse function arguments
            }

            console.log(`[${callId}] FUNCTION CALL: ${functionName}(${JSON.stringify(args)})`);

            const result = await handleToolCall(functionName, args, {
              callUuid: pl.callId,
            });
            console.log(`[${callId}] FUNCTION RESULT: ${result}`);

            const functionResult = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId_fn,
                output: result,
              },
            };
            logEvent(callId, functionResult.type);
            xaiWs.send(JSON.stringify(functionResult));

            const responseCreate = { type: "response.create" };
            logEvent(callId, responseCreate.type);
            xaiWs.send(JSON.stringify(responseCreate));
          })();
        }
      } else if (message.type === "conversation.item.input_audio_transcription.completed") {
        if (message.transcript) {
          console.log(`[${callId}] User: "${message.transcript}"`);
        }
      }
    } catch (error) {
      console.error(`[${callId}] Error processing message from x.ai:`, error);
    }
  });

  // Caller audio -> xAI (mu-law base64 passthrough)
  pl.on("media", (msg) => {
    try {
      if (msg.media.track === "inbound") {
        if (!sessionReady) return;
        if (xaiWs.readyState !== 1) return;

        xaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          }),
        );
      }
    } catch (error) {
      console.error(`[${callId}] Error processing audio from Plivo:`, error);
    }
  });

  xaiWs.on("error", (error: any) => {
    logEvent(callId, "websocket.error", error?.message || String(error));
  });

  xaiWs.on("close", (code: number) => {
    logEvent(callId, "websocket.close", `code=${code}`);
  });

  ws.on("close", () => {
    logEvent(callId, "plivo.close");
    xaiWs.close();
  });
});

/****************************************************
 Outbound Call Endpoints
****************************************************/

const OUTBOUND_AGENT_INSTRUCTIONS = `You are an outbound voice agent powered by the Grok Voice Agent API from xAI. You are calling a user to tell them about this exciting new technology.

IMPORTANT: You are making an OUTBOUND call, so YOU must speak first to initiate the conversation.

Start by greeting the user warmly and introducing yourself. Then explain:
- You're calling to share information about the Grok Voice Agent API
- This is a real-time voice AI API that enables natural conversations
- It supports telephony integration with Plivo and Twilio, WebRTC for browsers, and WebSocket connections
- The API features ultra-low latency, natural turn-taking, and high-quality voice synthesis
- Developers can build voice assistants, customer service agents, and interactive voice applications

Be enthusiastic but not pushy. Answer any questions they have about the technology. Keep responses concise since this is a phone call.

If they're not interested, politely thank them for their time and end the call gracefully.`;

// Answer URL for outbound calls — same Stream XML pattern
app.post("/outbound-answer", (req, res) => {
  if (!process.env.HOSTNAME) {
    res.status(500).send("Server misconfigured: HOSTNAME not set");
    return;
  }
  const hostname = publicHost(process.env.HOSTNAME);
  const streamUrl = `wss://${hostname}/outbound-stream`;
  res.type("text/xml");
  res.send(streamXml(streamUrl));
});

// WebSocket endpoint for outbound call audio
app.ws("/outbound-stream", (ws: any, req: any) => {
  const WebSocket = require("ws");
  const MAX_TURNS = 3;
  let callUuid = "";
  let streamId = "";
  let xaiWs: any = null;
  let sessionReady = false;
  let turnCount = 0;
  let turnActive = false;

  console.log(`\n[OUTBOUND] === OUTBOUND CALL STARTED ===`);

  const pl = new PlivoAudioStreamWebsocket(ws);

  pl.on("start", (msg) => {
    callUuid = msg.start.callId;
    streamId = msg.start.streamId;
    pl.callId = callUuid;
    pl.streamId = streamId;
    console.log(`[OUTBOUND] [${callUuid}] plivo.start`);

    xaiWs = new WebSocket(API_URL, {
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
    });

    xaiWs.on("open", () => {
      console.log(`[OUTBOUND] [${callUuid}] websocket.open`);

      const sessionConfig = {
        type: "session.update",
        session: {
          instructions: OUTBOUND_AGENT_INSTRUCTIONS,
          voice: "rex",
          audio: {
            input: { format: { type: "audio/pcmu" } },
            output: { format: { type: "audio/pcmu" } },
          },
          turn_detection: { type: "server_vad" },
        },
      };
      console.log(`[OUTBOUND] [${callUuid}] session.update`);
      xaiWs.send(JSON.stringify(sessionConfig));
    });

    xaiWs.on("message", (xaiData: Buffer) => {
      try {
        const message = JSON.parse(xaiData.toString());

        if (message.type !== "response.output_audio.delta") {
          console.log(`[OUTBOUND] [${callUuid}] ${message.type}`);
        }

        if (message.type === "session.updated") {
          sessionReady = true;
          xaiWs.send(JSON.stringify({ type: "response.create" }));
          console.log(`[OUTBOUND] [${callUuid}] Agent speaking first...`);
        } else if (message.type === "response.created") {
          if (turnActive) {
            console.log(`[OUTBOUND] [${callUuid}] === TURN ${turnCount} INTERRUPTED ===\n`);
          }
          turnCount++;
          turnActive = true;
          console.log(`\n[OUTBOUND] [${callUuid}] === START TURN ${turnCount} ===`);
        } else if (message.type === "response.output_audio.delta" && message.delta) {
          pl.send({
            event: "playAudio",
            media: {
              contentType: "audio/x-mulaw",
              sampleRate: 8000,
              payload: message.delta,
            },
          });
        } else if (message.type === "response.output_audio_transcript.delta") {
          if (message.delta) {
            console.log(`[OUTBOUND] [${callUuid}] Agent: "${message.delta}"`);
          }
        } else if (message.type === "conversation.item.input_audio_transcription.completed") {
          if (message.transcript) {
            console.log(`[OUTBOUND] [${callUuid}] Remote: "${message.transcript}"`);
          }
        } else if (message.type === "input_audio_buffer.speech_started") {
          if (streamId) {
            pl.send({ event: "clearAudio", streamId });
          }
        } else if (message.type === "response.done") {
          turnActive = false;
          console.log(`[OUTBOUND] [${callUuid}] === END TURN ${turnCount} ===\n`);

          if (turnCount >= MAX_TURNS) {
            console.log(`[OUTBOUND] [${callUuid}] Max turns reached, ending in 10s...`);
            setTimeout(async () => {
              console.log(`[OUTBOUND] [${callUuid}] Ending call now`);
              try {
                if (callUuid) await hangupCall(callUuid);
              } catch (e) {
                // fall through to socket close
              }
              if (xaiWs) xaiWs.close();
              ws.close();
            }, 10000);
          }
        } else if (message.type === "error") {
          console.log(
            `[OUTBOUND] [${callUuid}] ERROR: ${message.error?.message || JSON.stringify(message)}`,
          );
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    xaiWs.on("close", () => {
      console.log(`[OUTBOUND] [${callUuid}] websocket.close`);
    });
  });

  pl.on("media", (msg) => {
    if (msg.media?.track === "inbound") {
      if (xaiWs && sessionReady && xaiWs.readyState === WebSocket.OPEN) {
        xaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          }),
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(`[OUTBOUND] plivo.close`);
    if (xaiWs) xaiWs.close();
  });
});

/****************************************************
 Start Server
****************************************************/
const port = process.env.PORT || "3000";

async function start() {
  if (AUTO_PROVISION && PLIVO_AUTH_ID && PLIVO_AUTH_TOKEN && process.env.HOSTNAME) {
    try {
      const result = await provisionPlivoApplication({
        authId: PLIVO_AUTH_ID,
        authToken: PLIVO_AUTH_TOKEN,
        hostname: process.env.HOSTNAME,
        phoneNumber: process.env.PLIVO_PHONE_NUMBER,
        appId: process.env.PLIVO_APP_ID,
        appName: process.env.PLIVO_APP_NAME || "xai-plivo-telephony",
      });
      console.log(`[provision] answer_url=${result.answerUrl}`);
      console.log(`[provision] hangup_url=${result.hangupUrl}`);
      console.log(`[provision] app_id=${result.appId} numberAttached=${result.numberAttached}`);
    } catch (e: any) {
      console.warn(`[provision] Skipped / failed: ${e?.message || e}`);
      console.warn("[provision] Configure the Plivo Application Answer URL manually if needed.");
    }
  } else if (AUTO_PROVISION) {
    console.log(
      "[provision] Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and HOSTNAME to auto-provision webhooks.",
    );
  }

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Tool calling: ${ENABLE_TOOLS ? "ENABLED" : "DISABLED"}`);
    if (process.env.HOSTNAME) {
      const base = publicHttpsBase(process.env.HOSTNAME);
      console.log(`Answer URL:  ${base}/answer`);
      console.log(`Hangup URL:  ${base}/hangup`);
    }
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
