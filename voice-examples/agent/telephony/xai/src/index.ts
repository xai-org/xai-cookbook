import "dotenv-flow/config";
import express from "express";
import expressWs from "express-ws";
import type { Request, Response } from "express";
import * as crypto from "crypto";
import { TwilioMediaStreamWebsocket } from "./twilio";
import twilio from "twilio";
import WebSocket from "ws";

const baseApp = express();
const wsInstance = expressWs(baseApp);
const app = wsInstance.app;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ========================================
// Configuration
// ========================================
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const API_URL = process.env.API_URL || "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ========================================
// Tools
// ========================================
const tools = [
  { type: "web_search" },
  {
    type: "function",
    name: "transfer_call",
    description: "Use this ONLY after confirming the customer wants a live agent or needs order/personal info.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"]
    }
  }
];

// ========================================
// Logging
// ========================================
function logEvent(callId: string, eventType: string, extra?: string) {
  if (extra) console.log(`[${callId}] ${eventType} - ${extra}`);
  else console.log(`[${callId}] ${eventType}`);
}

function generateSecureId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

// ========================================
// TwiML Webhook
// ========================================
app.post("/twiml", (req: Request, res: Response): void => {
  const callId = generateSecureId("call");
  if (!process.env.HOSTNAME) {
    res.status(500).send("HOSTNAME not set");
    return;
  }
  const hostname = process.env.HOSTNAME.replace(/^https?:\/\//, "");
  const streamUrl = `wss://${hostname}/media-stream/${callId}`;

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  const connect = response.connect();
  connect.stream({ url: streamUrl });

  res.type("text/xml").send(response.toString());
});

// ========================================
// Transfer Handler
// ========================================
async function handleTransfer(callSid: string) {
  const targetNumber = "+19044202923";
  try {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say("You are being transferred back to our main support line. Please pick the option most applicable to your request, or press 0 to come back to me.");
    response.dial(targetNumber);

    await twilioClient.calls(callSid).update({
      twiml: response.toString()
    });
    console.log(`[${callSid}] TRANSFER EXECUTED to ${targetNumber}`);
  } catch (err) {
    console.error("Transfer failed:", err);
  }
}

// ========================================
// Media Stream WebSocket
// ========================================
app.ws("/media-stream/:callId", (ws: WebSocket, req: Request) => {
  const callId = req.params.callId;
  console.log(`\n[${callId}] === CALL STARTED ===`);

  const tw = new TwilioMediaStreamWebsocket(ws);
  let streamSid: string | null = null;
  let callSidFromTwilio: string | null = null;

  tw.on("start", (msg: any) => {
    streamSid = msg.start.streamSid;
    callSidFromTwilio = msg.start.callSid;
    logEvent(callId, "twilio.start");
  });

  const xaiWs = new WebSocket(API_URL, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` }
  });

  let sessionReady = false;

  xaiWs.on("open", () => logEvent(callId, "xai.websocket.open"));
  xaiWs.on("error", (err) => console.error(`[${callId}] XAI ERROR:`, err));

  xaiWs.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      logEvent(callId, message.type);

      if (message.type === "response.output_audio.delta" && message.delta && streamSid) {
        tw.send({ event: "media", streamSid, media: { payload: message.delta } });
      } 
      else if (message.type === "conversation.created") {
        logEvent(callId, "conversation.created - sending full prompt");
        xaiWs.send(JSON.stringify({
          type: "session.update",
          session: {
            instructions: `You are the official friendly AI support agent for Derya Arms (www.derya.us).
Be concise. Keep responses short and natural (1-2 sentences max).
ALWAYS:
- First use the web_search tool with "site:www.derya.us OR site:support.derya.us".
- Be professional, warm, and helpful. Respond in the same language the caller uses.
For order updates, tracking, payments, warranty requests, or any personal account info:
- Say: "For the fastest response on orders and warranty requests, please use the chat function on our website or visit www.derya.us to fill out a customer support form. Would you like me to transfer you to our main support line so a live agent can pull up your details right away?"
If the caller wants a live human, says "transfer", "live agent", "speak to someone", "order support", etc.:
- Offer the transfer naturally, then use the "transfer_call" tool.`,
            tools: tools,
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 400,
              prefix_padding_ms: 300
            },
            audio: {
              input: { format: { type: "audio/pcmu" } },
              output: { format: { type: "audio/pcmu" } }
            }
          }
        }));
      } 
      else if (message.type === "session.updated") {
        sessionReady = true;
        logEvent(callId, "session.updated - STARTING RESPONSE");
        xaiWs.send(JSON.stringify({
          type: "response.create",
          response: { modalities: ["text", "audio"] }
        }));
      } 
      else if (message.type === "response.output_item.done" && message.item?.name === "transfer_call" && callSidFromTwilio) {
        await handleTransfer(callSidFromTwilio);
      } 
      else if (message.type === "response.function_call_arguments.done" && message.name === "transfer_call" && callSidFromTwilio) {
        await handleTransfer(callSidFromTwilio);
      } 
      // ← Claude's barge-in fix
      else if (message.type === "input_audio_buffer.speech_started" && streamSid) {
        tw.send({ event: "clear", streamSid });
        logEvent(callId, "barge-in detected - clearing audio");
      }
    } catch (e) {
      console.error(e);
    }
  });

  tw.on("media", (msg: any) => {
    if (msg.media.track === "inbound" && sessionReady && xaiWs.readyState === WebSocket.OPEN) {
      xaiWs.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: msg.media.payload
      }));
    }
  });

  ws.on("close", () => xaiWs.close());
  xaiWs.on("close", () => ws.close());
});

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
