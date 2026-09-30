# XAI Voice WebRTC Client

React + TypeScript web client for real-time voice interaction using WebRTC.

## Overview

This client provides a modern web interface for voice interaction with XAI's API using WebRTC technology:
- WebRTC peer connection for low-latency communication
- Real-time audio streaming via DataChannel
- Connection quality monitoring with live statistics
- Interactive UI with transcript and debug console
- WebRTC-specific features (bitrate, jitter, packet loss display)

## Features

### Core Features
- WebRTC peer-to-peer connection to server
- Real-time voice interaction
- Server-side Voice Activity Detection (VAD)
- Conversation transcripts (user and assistant)
- Interruption handling (cancel ongoing responses)
- Microphone level indicator

### WebRTC-Specific Features
- Connection quality monitoring (excellent/good/fair/poor)
- Live statistics panel:
  - Audio bitrate (in/out)
  - Jitter
  - Packet loss
  - Round trip time (RTT)
  - Connection state
  - ICE connection state
- Quality-based status indicator (color-coded)
- Debug console for DataChannel messages

## Prerequisites

- **Node.js**: 18 or higher
- **npm**: Latest version
- **Browser**: Chrome 89+ or Edge 89+ (recommended)
- **Running Server**: WebRTC server must be running (see `../server/`)

## Quick Start

### 1. Start the Server

First, make sure the WebRTC server is running:

```bash
cd ../server
./start.sh
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Client

```bash
./start.sh
```

Or manually:

```bash
npm run dev
```

### 4. Open Browser

Navigate to `http://localhost:5173`

### 5. Start Conversation

1. Click the green **START** button (clears previous transcript)
2. Allow microphone access when prompted
3. The bot will greet you automatically
4. Speak naturally - the bot will respond
5. You can interrupt the bot at any time
6. Click the red **STOP** button to end (transcript remains visible)
7. Click **START** again to begin a new session

## Configuration

### Environment Variables

The client uses one optional environment variable. Create a `.env` file in the client directory if you need to customize the backend URL:

```bash
# Backend server URL (optional)
# Default: http://localhost:8000
VITE_API_BASE_URL=http://localhost:8000
```

**Default**: `http://localhost:8000` (matches WebRTC server default port)

**When to customize**:
- If your server runs on a different port
- If your server is on a different machine/domain
- For production deployments

**Example**: If server is on port 8001:
```bash
VITE_API_BASE_URL=http://localhost:8001
```

### TURN Server Configuration

The client includes an `ENABLE_TURN` flag to optionally enable TURN servers for restrictive network environments.

**Location**: `src/hooks/useWebRTC.ts` (line 13)

```typescript
const ENABLE_TURN = false;  // Default: false (STUN only)
```

**When to enable**:
- Restrictive corporate firewalls that block UDP
- Networks that require TURN relay for connectivity
- Testing TURN server functionality

**Note**: Enabling TURN may add 10-15 seconds to connection time if TURN server is slow or unreachable. Most networks work fine with STUN only (default setting).

## UI Components

### Top Bar

- **Title**: "XAI Voice Demo"
- **Protocol Badge**: Shows "WebRTC" in cyan
- **Connection Status**: 
  - Color-coded dot (green/yellow/red based on quality)
  - Shows connection state and quality level
  - Example: "Connected (excellent)"

### Control Panel

- **START Button**: Initiates WebRTC connection and audio capture
- **STOP Button**: Disconnects and stops capture
- **Status**: Shows current state (Not connected, Connected, Recording)
- **Microphone Level**: Visual bar showing real-time audio input level

### WebRTC Stats Panel

Real-time connection statistics:

- **Connection Quality**: excellent/good/fair/poor with color indicator
- **Connection State**: new/connecting/connected/disconnected/failed/closed
- **ICE State**: new/checking/connected/completed/failed/disconnected/closed
- **Audio In**: Incoming bitrate (bps/kbps/Mbps)
- **Audio Out**: Outgoing bitrate (bps/kbps/Mbps)
- **Jitter**: Network jitter in milliseconds
- **Packet Loss**: Total packets lost
- **Round Trip Time**: Latency in milliseconds

**Quality Indicators**:
- **Excellent**: <10 packet loss, <30ms jitter
- **Good**: <50 packet loss, <50ms jitter
- **Fair**: <100 packet loss, <100ms jitter
- **Poor**: >100 packet loss or >100ms jitter

### Transcript Panel

Shows conversation history:
- **USER**: Your speech transcribed (green)
- **ASSISTANT**: Bot responses (cyan)
- Timestamps for each message
- Auto-scrolls to latest message
- **Persists when STOP is clicked** (review previous conversation)
- **Clears when START is clicked** (begins new session)

### Debug Console

Shows all DataChannel messages (excluding audio):
- **SEND**: Messages sent to server (yellow)
- **RECV**: Messages received from server (cyan)
- JSON formatted for readability
- Auto-scrolls to latest message
- Useful for debugging connection issues

## Architecture

```
Browser (This Client)
    ↓
  WebRTC Connection
    ↓ (Signaling via WebSocket)
    ↓ (Audio + Control via DataChannel)
    ↓
  WebRTC Server
    ↓ (WebSocket)
    ↓
  XAI API
```

### Communication Flow

1. **Session Creation**: Client requests session from server (HTTP POST)
2. **Signaling**: WebSocket connection for SDP offer/answer and ICE candidates
3. **Peer Connection**: WebRTC connection established
4. **DataChannel**: All messages and audio sent via DataChannel
5. **Stats Collection**: Periodic polling of WebRTC stats

### Audio Flow

- **Microphone** → `getUserMedia()` → PCM16 encoding → DataChannel → Server
- **Server** → DataChannel → PCM16 decoding → `AudioContext` → **Speakers**

**Note**: Mobile browsers not officially supported due to audio API limitations.

## Development

### Scripts

```bash
# Install dependencies
npm install

# Development server with HMR
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## Audio Format

- **Sample Rate**: Native browser sample rate (auto-detected, typically 48kHz, 44.1kHz, or 24kHz)
- **Format**: PCM16 (16-bit PCM)
- **Channels**: Mono
- **Encoding**: Base64 in DataChannel messages
- **Chunk Size**: ~100ms

## Known Limitations

- Mobile browser support not fully tested
- Safari may have compatibility issues
- High packet loss degrades experience
- Requires running server (can't connect directly to XAI API)
