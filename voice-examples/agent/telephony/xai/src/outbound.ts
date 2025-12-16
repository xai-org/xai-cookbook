/**
 * Outbound Calling Script
 * 
 * Makes an outbound call using Twilio. The call connects to the main server's
 * /outbound-stream WebSocket endpoint which handles the XAI voice agent.
 * 
 * Usage:
 *   npm run outbound
 * 
 * Environment variables required:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_PHONE_NUMBER (your Twilio phone number to call from)
 *   - TARGET_PHONE_NUMBER (the phone number to call)
 *   - HOSTNAME (your server's public URL, e.g., https://abc123.ngrok.io)
 * 
 * Note: The main server (npm run dev) must be running to handle the call.
 */

import "dotenv-flow/config";
import Twilio from "twilio";
import log from "./logger";

// Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const TARGET_PHONE_NUMBER = process.env.TARGET_PHONE_NUMBER || "";
const HOSTNAME = process.env.HOSTNAME || "";

// Validate environment
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error("❌ Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}
if (!TWILIO_PHONE_NUMBER) {
  console.error("❌ Missing TWILIO_PHONE_NUMBER");
  process.exit(1);
}
if (!TARGET_PHONE_NUMBER) {
  console.error("❌ Missing TARGET_PHONE_NUMBER");
  process.exit(1);
}
if (!HOSTNAME) {
  console.error("❌ Missing HOSTNAME (e.g., https://abc123.ngrok.io)");
  process.exit(1);
}

// Initialize Twilio client
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Make the outbound call
async function makeOutboundCall(): Promise<string> {
  const twimlUrl = `${HOSTNAME}/outbound-twiml`;
  
  log.app.info("[OUTBOUND] ========================================");
  log.app.info("[OUTBOUND] Making outbound call");
  log.app.info("[OUTBOUND] ========================================");
  log.app.info(`[OUTBOUND] To: ${TARGET_PHONE_NUMBER}`);
  log.app.info(`[OUTBOUND] From: ${TWILIO_PHONE_NUMBER}`);
  log.app.info(`[OUTBOUND] TwiML URL: ${twimlUrl}`);
  log.app.info("");

  try {
    const call = await twilioClient.calls.create({
      to: TARGET_PHONE_NUMBER,
      from: TWILIO_PHONE_NUMBER,
      url: twimlUrl,
    });

    log.app.info(`[OUTBOUND] Call initiated - SID: ${call.sid}`);
    log.app.info("[OUTBOUND] Check the main server logs for call progress.");
    return call.sid;
  } catch (error: any) {
    log.app.error("[OUTBOUND] Failed to make call:", error.message);
    throw error;
  }
}

makeOutboundCall().catch(console.error);
