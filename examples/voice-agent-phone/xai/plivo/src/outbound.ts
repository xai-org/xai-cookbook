/**
 * Outbound Calling Script
 * 
 * Makes an outbound call using Plivo. The call connects to the main server's
 * /outbound-answer XML endpoint and /outbound-stream WebSocket which handle the XAI voice agent.
 * 
 * Usage:
 *   npm run outbound
 * 
 * Environment variables required:
 *   - PLIVO_AUTH_ID
 *   - PLIVO_AUTH_TOKEN
 *   - PLIVO_PHONE_NUMBER (your Plivo phone number to call from)
 *   - TARGET_PHONE_NUMBER (the phone number to call)
 *   - HOSTNAME (your server's public URL, e.g., https://abc123.ngrok.io)
 * 
 * Note: The main server (npm run dev) must be running to handle the call.
 */

import "dotenv-flow/config";
import plivo from "plivo";
import log from "./logger";

// Configuration
const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID || "";
const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN || "";
const PLIVO_PHONE_NUMBER = process.env.PLIVO_PHONE_NUMBER || "";
const TARGET_PHONE_NUMBER = process.env.TARGET_PHONE_NUMBER || "";
const HOSTNAME = process.env.HOSTNAME || "";

// Validate environment
if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
  console.error("❌ Missing PLIVO_AUTH_ID or PLIVO_AUTH_TOKEN");
  process.exit(1);
}
if (!PLIVO_PHONE_NUMBER) {
  console.error("❌ Missing PLIVO_PHONE_NUMBER");
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

// Initialize Plivo client
const client = new plivo.Client(PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN);


function publicHttpsBase(hostname: string): string {
  const cleaned = hostname.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned.replace(/^http:\/\//, "https://");
  }
  return `https://${cleaned}`;
}

// Make the outbound call
async function makeOutboundCall(): Promise<string> {
  const answerUrl = `${publicHttpsBase(HOSTNAME)}/outbound-answer`;
  
  log.app.info("[OUTBOUND] ========================================");
  log.app.info("[OUTBOUND] Making outbound call");
  log.app.info("[OUTBOUND] ========================================");
  log.app.info(`[OUTBOUND] To: ${TARGET_PHONE_NUMBER}`);
  log.app.info(`[OUTBOUND] From: ${PLIVO_PHONE_NUMBER}`);
  log.app.info(`[OUTBOUND] Answer URL: ${answerUrl}`);
  log.app.info("");

  try {
    // plivo.Client.calls.create(from, to, answerUrl, optionalParams)
    // Docs: https://plivo.com/docs/voice/api/calls
    const call = await client.calls.create(
      PLIVO_PHONE_NUMBER,
      TARGET_PHONE_NUMBER,
      answerUrl,
      { answerMethod: "POST" },
    );

    const requestUuid =
      (call as any).requestUuid ||
      (call as any).request_uuid ||
      JSON.stringify(call);
    log.app.info(`[OUTBOUND] Call initiated - request: ${requestUuid}`);
    log.app.info("[OUTBOUND] Check the main server logs for call progress.");
    return String(requestUuid);
  } catch (error: any) {
    log.app.error("[OUTBOUND] Failed to make call:", error.message);
    throw error;
  }
}

makeOutboundCall().catch(console.error);
