# XAI Voice WebRTC Agent Example

> **IMPORTANT DISCLAIMER**  
> **These are example implementations for learning and development purposes only.**  
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**  

Real-time voice agent using WebRTC for browser communication and WebSocket for XAI API integration.

## Overview

This example demonstrates a WebRTC-based voice agent that provides:
- **Low-latency** voice communication via WebRTC
- **Real-time** bidirectional audio streaming
- **Connection quality** monitoring (bitrate, jitter, packet loss)
- **Server-side relay** between WebRTC (browser) and WebSocket (XAI API)

## Architecture

```
Browser (WebRTC Client)
    ↓ WebRTC (PCM16 via DataChannel)
    ↓
Node.js Server (Relay)
    ↓ WebSocket (PCM16 pass-through)
    ↓
XAI API
```

The server acts as a relay:
- **Client → Server**: WebRTC DataChannel with PCM16 audio
- **Server → XAI**: WebSocket with PCM16 audio format
- **No audio conversion needed**: PCM16 used throughout

## Quick Start

### Prerequisites

- Node.js 18 or higher
- XAI API key
- Chrome or Edge browser (WebRTC support)

### 1. Start the Server

```bash
cd server
# Create .env file with your XAI_API_KEY
echo "XAI_API_KEY=your_key_here" > .env
./start.sh
```

The server will start on port 8000 (configurable via `.env`).

### 2. Start the Client

```bash
cd client
./start.sh
```

The client will start on port 5173.

### 3. Open Browser

Navigate to `http://localhost:5173` and click START to begin voice conversation.

## Components

### Server (`/server`)

Node.js + TypeScript server that:
- Accepts WebRTC connections from browsers
- Handles signaling (SDP offer/answer, ICE candidates)
- Relays PCM16 audio via DataChannel
- Connects to XAI API via WebSocket
- Collects connection quality stats

**Tech Stack**: Express, `werift` (pure JS WebRTC), WebSocket, TypeScript

See [server/README.md](server/README.md) for details.

### Client (`/client`)

React + TypeScript web application that:
- Establishes WebRTC connection to server
- Captures microphone audio via WebRTC
- Displays real-time transcripts
- Shows WebRTC connection quality stats
- Provides debug console for messages

**Tech Stack**: React, Vite, WebRTC API, TypeScript

See [client/README.md](client/README.md) for details.

## Features

### WebRTC Features
- Client-server WebRTC connection
- DataChannel for audio and control messages
- STUN/TURN support for NAT traversal (configurable)
- Connection quality monitoring
- PCM16 audio format (no codec conversion needed)

### Voice Agent Features
- Real-time voice interaction
- Server-side Voice Activity Detection (VAD)
- Conversation transcripts
- Interruption handling
- Debug console for monitoring

### UI Features
- WebRTC badge in header
- Connection quality indicator
- Stats panel (bitrate, jitter, packet loss, RTT)
- Microphone level indicator
- Live transcript display (persists between sessions)

## Configuration

### Server Configuration

Edit `server/.env`:

```bash
# Required
XAI_API_KEY=your_xai_api_key_here

# Optional
PORT=8000
VOICE=ara
INSTRUCTIONS="You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud."
API_URL=wss://api.x.ai/v1/realtime
```

### Client Configuration

The client automatically connects to `http://localhost:8000` (or `VITE_API_BASE_URL` if set).

### TURN Server Configuration

Both client and server include an `ENABLE_TURN` flag to optionally enable TURN servers for restrictive network environments:

**Location**: 
- Client: `client/src/hooks/useWebRTC.ts` (line 13)
- Server: `server/src/rtc-peer.ts` (line 9)

**Default**: `false` (STUN only, recommended for most networks)

**When to enable**:
- Restrictive corporate firewalls that block UDP
- Networks that require TURN relay
- Testing TURN server functionality

**Note**: Enabling TURN may add 10-15 seconds to connection time if TURN server is slow/unreachable. Most connections work fine with STUN only.

**Recommended**: Chrome or Edge for best compatibility.

## Comparison with WebSocket Version

| Feature | WebSocket Version | WebRTC Version |
|---------|------------------|----------------|
| Audio Transport | WebSocket | WebRTC DataChannel |
| Control Messages | WebSocket | WebRTC DataChannel |
| Audio Format | PCM16 | PCM16 |
| NAT Traversal | N/A (direct connection) | STUN/TURN |
| Connection Quality Stats | No | Yes (detailed) |
| Browser Support | All modern | Chrome/Edge recommended |
| Connection Time | Fast (~1s) | Fast (~1s, or slower with TURN) |

## Development

Both client and server use TypeScript for type safety and better developer experience.

### Server Development

```bash
cd server
npm run dev  # Run with ts-node (no build step)
npm run watch  # Watch mode for TypeScript
```

### Client Development

```bash
cd client
npm run dev  # Vite dev server with HMR
```

