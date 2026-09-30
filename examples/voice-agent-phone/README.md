# Grok Voice Agent API - Telephony Agent Examples

> **IMPORTANT DISCLAIMER**  
> **These are example implementations for learning and development purposes only.**  
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**  

Voice agents accessible via phone calls using Twilio integration.

## Overview

These examples demonstrate how to build voice agents that can be accessed via phone calls. Perfect for IVR systems, call centers, and voice-based customer service.

## Available Examples

### [XAI Native](xai/)

Native XAI implementation with Twilio Media Streams.

**Features:**
- Direct WebSocket integration with XAI
- Real-time voice processing
- Session management

**Tech Stack:**
- Node.js + TypeScript
- Twilio Media Streams
- WebSockets
- Express server

## Quick Start

### XAI Native (Recommended)

```bash
cd xai
npm install

# Configure environment
cp .env.example .env
# Edit .env with your keys

# Start server
npm run dev

# Expose to internet (for Twilio)
ngrok http 3000

# Configure Twilio webhook with ngrok URL
# Call your Twilio number!
```

## Architecture

### Call Flow

```
┌─────────┐    1. SIP    ┌─────────────┐   2. WebSocket   ┌──────────────┐
│  Phone  │ ←──────────→ │   Twilio    │ ←──────────────→ │  Your Server │
│  Call   │   Audio      │Media Streams│  μ-law (native)  │  (Node.js)   │
└─────────┘              └─────────────┘                  └──────────────┘
                                                                 ↓
                                                           3. WebSocket
                                                                 ↓
                                                          ┌──────────────┐
                                                          │   XAI API    │
                                                          │  (Realtime)  │
                                                          └──────────────┘
```

### Data Flow

1. **Phone → Twilio**: Caller dials your Twilio number
2. **Twilio → Server**: Twilio streams μ-law PCM audio via WebSocket
3. **Server → XAI**: Server forwards μ-law audio directly to XAI Realtime API (no conversion)
4. **XAI → Server**: AI responds with μ-law audio and text
5. **Server → Twilio**: Server forwards μ-law audio directly to Twilio (no conversion)
6. **Twilio → Phone**: Caller hears AI response

## Prerequisites

### Required Accounts

1. **XAI Account**
   - Get API key: [console.x.ai](https://console.x.ai/)
   - Realtime API access

2. **Twilio Account**
   - Sign up: [console.twilio.com](https://console.twilio.com/)
   - Phone number with voice capabilities
   - Media Streams enabled

### Technical Requirements

- **Node.js**: 18+ 
- **Public Endpoint**: ngrok or deployed server
- **Port**: 3000 (configurable)

## Setup Guide

### 1. Get Twilio Credentials

```bash
# From Twilio Console
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

### 2. Configure Environment

```bash
cd xai
cp .env.example .env

# Edit .env with:
XAI_API_KEY=your_xai_api_key_here
HOSTNAME=your-ngrok-domain.ngrok.app
```

### 3. Expose to Internet

**Using ngrok:**
```bash
# Install ngrok
brew install ngrok  # macOS
# or download from ngrok.com

# Start your server first
npm run dev

# In another terminal, expose it
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

### 4. Configure Twilio Webhook

1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to Phone Numbers → Manage → Active Numbers
3. Click your phone number
4. Under "Voice & Fax", set:
   - **A call comes in**: Webhook
   - **URL**: `https://your-ngrok-url.ngrok.io/twiml`
   - **Method**: POST
5. Save

### 5. Test the Call

```bash
# Call your Twilio number
# You should hear the AI agent!
```

## Features

### XAI Native Features

- Real-time voice processing
- Low latency responses
- Session management
- Call logging
- Error handling
- Graceful disconnection

## Configuration Options

### Environment Variables

```bash
# Required
XAI_API_KEY=your_key_here
HOSTNAME=your-ngrok-domain.ngrok.app

# Optional (with defaults)
API_URL=wss://api.x.ai/v1/realtime
PORT=3000
```

**Note:** Twilio credentials are configured in the [Twilio Console](https://console.twilio.com/), not as environment variables.

### Voice Configuration

```typescript
// In your code
const sessionConfig = {
  type: "session.update",
  session: {
    voice: "Ara", // Choose from: Ara, Rex, Sal, Eve, Leo
    instructions: "You are a helpful assistant.",
    // Audio format settings (these are the defaults if not specified)
    audio: {
      input: { format: { type: "audio/pcm", rate: 24000 } },
      output: { format: { type: "audio/pcm", rate: 24000 } }
    }
  }
};
```

## Audio Processing

### Audio Format (No Conversion Needed!)

**End-to-End Format:**
- Format: μ-law PCM (audio/pcmu)
- Sample Rate: 8kHz
- Encoding: Base64

**Twilio → Server → XAI:**
- μ-law audio passes through without conversion
- XAI API natively supports PCMU (μ-law) format

**XAI → Server → Twilio:**
- μ-law audio passes through without conversion
- Direct passthrough improves latency and audio quality

### Audio Pipeline

```javascript
// Incoming audio from Twilio (μ-law @ 8kHz)
const twilioAudio = μ-law PCM @ 8kHz

// Send directly to XAI (configured for native μ-law input)
await xaiWebSocket.send(twilioAudio)

// Receive from XAI (μ-law @ 8kHz - native telephony format)
const xaiResponse = μ-law PCM @ 8kHz

// Send directly to Twilio
await twilioWebSocket.send(xaiResponse)
```

**Key Improvement:** XAI API supports native μ-law (PCMU) and A-law (PCMA) formats, eliminating the need for PCM16 conversion and improving audio quality and latency.

## Monitoring & Debugging

### Enable Logging

```bash
# Set log level
LOG_LEVEL=debug npm run dev
```

### Check WebSocket Connection

```typescript
// Connection events
ws.on('open', () => console.log('Connected to XAI'));
ws.on('close', () => console.log('Disconnected from XAI'));
ws.on('error', (err) => console.error('WebSocket error:', err));
```

## Testing

### Local Testing

```bash
# Start server
npm run dev

# Use ngrok for external access
ngrok http 3000

# Call your Twilio number
```

### Test Call Script

```bash
# Make a test call via Twilio API
curl -X POST https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json \
  --data-urlencode "Url=http://your-server.com/twiml" \
  --data-urlencode "To=+1234567890" \
  --data-urlencode "From=$TWILIO_PHONE_NUMBER" \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN
```

## Documentation

- **[XAI Implementation README](xai/README.md)** - XAI implementation details
- **[Twilio Docs](https://www.twilio.com/docs/voice/media-streams)** - Twilio Media Streams
- **[XAI API Docs](https://x.ai/api)** - XAI Realtime API

## Examples

### Use Cases

**IVR System:**
- Menu navigation
- Call routing
- Information gathering

**Customer Support:**
- First-line support
- FAQ handling
- Appointment scheduling

**Surveys:**
- Voice surveys
- Feedback collection
- Market research

**Notifications:**
- Appointment reminders
- Payment alerts
- Status updates