# XAI Voice WebRTC Server

> **IMPORTANT DISCLAIMER**  
> **These are example implementations for learning and development purposes only.**  
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**  

Node.js + TypeScript WebRTC-to-WebSocket relay server for XAI's realtime voice API.

## Overview

This server acts as a relay between WebRTC clients (browsers) and the XAI API:
- Accepts WebRTC connections from browsers
- Handles WebRTC signaling (SDP offer/answer, ICE candidates)
- Manages peer connections using the `werift` library (pure JavaScript WebRTC)
- Relays PCM16 audio via DataChannel (no codec conversion needed)
- Relays messages between WebRTC DataChannel and XAI WebSocket API
- Collects and reports WebRTC statistics

## Architecture

```
Browser Client                    This Server                   XAI API
     |                                  |                           |
     |-- WebRTC Connection ------------>|                           |
     |   (DataChannel Only)             |                           |
     |                                  |-- WebSocket Connection -->|
     |                                  |                           |
     |<== Audio (PCM16) ===============|<== Audio (PCM16) =========|
     |   via DataChannel                |   via WebSocket           |
     |<== Messages (DataChannel) ======|<== Messages (WebSocket) ==|
```

## Prerequisites

- **Node.js**: 18 or higher
- **npm**: Latest version
- **XAI API Key**: Required for XAI API access

**Note**: This server uses `werift`, a pure JavaScript implementation of WebRTC. No native compilation or build tools required!

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

**Note**: Fast installation - no native compilation required thanks to `werift`!

### 2. Configure Environment

Create a `.env` file in the server directory with your configuration:

```bash
# Required
XAI_API_KEY=your_xai_api_key_here

# Optional (defaults shown)
PORT=8000
API_URL=wss://api.x.ai/v1/realtime
VOICE=ara
INSTRUCTIONS="You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud."
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173,http://localhost:8080"
```

**Example `.env` file**:
```bash
XAI_API_KEY=xai-abc123def456...
PORT=8000
VOICE=ara
INSTRUCTIONS="You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud."
```

### 3. Start the Server

```bash
./start.sh
```

Or manually:

```bash
npm run build
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## API Endpoints

### REST Endpoints

#### `GET /`
Service information

**Response**:
```json
{
  "service": "XAI Voice WebRTC Server",
  "provider": "XAI",
  "protocol": "WebRTC",
  "version": "1.0.0",
  "status": "running",
  "endpoints": {
    "health": "/health",
    "sessions": "/sessions",
    "signaling": "/signaling/{session_id}"
  }
}
```

#### `GET /health`
Health check and server status

**Response**:
```json
{
  "status": "healthy",
  "provider": "XAI",
  "protocol": "WebRTC",
  "timestamp": "2025-11-10T12:00:00.000Z",
  "sessions_active": 0,
  "peer_connections_active": 0,
  "config": {
    "api_key_configured": true,
    "api_url": "wss://api.x.ai/v1/realtime",
    "port": 8000,
    "voice": "ara"
  }
}
```

#### `POST /sessions`
Create a new session

**Response**:
```json
{
  "session_id": "session_1699632000000_abc123",
  "signaling_url": "/signaling/session_1699632000000_abc123",
  "created_at": "2025-11-10T12:00:00.000Z"
}
```

#### `GET /sessions`
List all active sessions

**Response**:
```json
{
  "sessions": [
    {
      "id": "session_1699632000000_abc123",
      "created_at": "2025-11-10T12:00:00.000Z",
      "status": "active",
      "webrtc_stats": {
        "bitrate": {
          "audio_in": 0,
          "audio_out": 0
        },
        "jitter": 0,
        "packetLoss": 0,
        "connectionState": "connected",
        "iceConnectionState": "connected",
        "lastUpdated": "2025-11-10T12:00:05.000Z"
      }
    }
  ],
  "count": 1
}
```

#### `DELETE /sessions/:sessionId`
Delete a session

**Response**:
```json
{
  "message": "Session deleted",
  "session_id": "session_1699632000000_abc123"
}
```

#### `GET /sessions/:sessionId/stats`
Get WebRTC statistics for a session

**Response**:
```json
{
  "session_id": "session_1699632000000_abc123",
  "stats": {
    "bitrate": {
      "audio_in": 32000,
      "audio_out": 64000
    },
    "jitter": 0.015,
    "packetLoss": 2,
    "connectionState": "connected",
    "iceConnectionState": "connected",
    "lastUpdated": "2025-11-10T12:00:10.000Z"
  }
}
```

### WebSocket Endpoints

#### `WS /signaling/:sessionId`
WebRTC signaling endpoint for SDP offer/answer and ICE candidate exchange

**Client → Server Messages**:

```json
// Answer to server's offer
{
  "type": "answer",
  "sdp": "v=0\r\no=- ... (full SDP)"
}

// ICE candidate
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

**Server → Client Messages**:

```json
// Initial offer
{
  "type": "offer",
  "sdp": "v=0\r\no=- ... (full SDP)"
}

// Ready notification
{
  "type": "ready"
}

// Error
{
  "type": "error",
  "message": "Error description"
}
```

## WebRTC Configuration

### ICE Servers

The server configures ICE servers for NAT traversal. By default, only STUN is enabled:

```javascript
iceServers: [
  // STUN servers (Google - always enabled)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },  // Backup
]
```

**TURN Server Support**:
TURN servers can be optionally enabled via the `ENABLE_TURN` flag in `src/rtc-peer.ts` (line 9).

```javascript
// Set to true to enable TURN servers (for restrictive networks)
const ENABLE_TURN = false;  // Default: false
```

When enabled, adds:
```javascript
{
  urls: 'turn:openrelay.metered.ca:80',
  username: 'openrelayproject',
  credential: 'openrelayproject'
}
```

**Note**: TURN servers may add 10-15 seconds to connection time if slow/unreachable. Most networks work fine with STUN only.

### Audio Format Strategy

The server uses a hybrid approach to handle audio:

1. **Browser → Server**: PCM16 audio sent via WebRTC DataChannel
2. **Server → XAI**: PCM16 audio forwarded via WebSocket
3. **XAI → Server**: PCM16 audio received via WebSocket
4. **Server → Browser**: PCM16 audio sent via DataChannel

**Why not use WebRTC audio tracks directly?**
- Avoids complex Opus ↔ PCM16 codec conversion
- Eliminates need for additional native dependencies
- Maintains audio quality
- WebRTC connection still used for ICE/STUN/TURN and connection management

## Project Structure

```
server/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── types.ts              # TypeScript type definitions
│   ├── session-manager.ts    # Session lifecycle management
│   ├── rtc-peer.ts           # WebRTC peer connection manager
│   ├── xai-client.ts         # XAI API WebSocket client
│   └── audio-processor.ts    # Audio format utilities
├── dist/                     # Compiled JavaScript (generated)
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── start.sh                  # Startup script
└── README.md                 # This file
```

## Development

### Scripts

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run compiled JavaScript
npm start

# Development mode (ts-node, no build)
npm run dev

# Watch mode (recompile on changes)
npm run watch
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XAI_API_KEY` | Yes | - | Your XAI API key |
| `API_URL` | No | `wss://api.x.ai/v1/realtime` | XAI API endpoint |
| `PORT` | No | `8000` | Server port |
| `VOICE` | No | `ara` | XAI voice model |
| `INSTRUCTIONS` | No | Default greeting | System instructions for XAI |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000,http://localhost:5173,http://localhost:8080` | CORS allowed origins (comma-separated) |

