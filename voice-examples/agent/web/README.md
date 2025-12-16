# Web Examples

> **IMPORTANT DISCLAIMER**
> **These are example implementations for learning and development purposes only.**
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**

Web-based voice interaction examples for XAI's realtime voice API. These examples demonstrate a clean separation between frontend and backend, allowing you to swap backends without changing frontend code.

## Architecture

All examples follow this architecture:
```
Browser (Web Client)
    ↓ WebSocket + REST API
    ↓
Backend (Python or Node.js)
    ↓ WebSocket
    ↓
XAI Realtime Voice API
```

## Components

### Frontend
**Location**: `client/`

- Single React + TypeScript web application
- Works with both Python and Node.js backends
- Features:
  - Real-time audio streaming
  - Debug console (shows all non-audio WebSocket messages)
  - Live conversation transcript
  - Microphone level indicator

### Backends

All backends expose the **same REST and WebSocket API**, making them interchangeable from the frontend's perspective. All run on port 8000 by default.

#### XAI Backends
**Location**: `xai/`

- **Python**: `xai/backend-python/` - FastAPI + websockets
- **Node.js**: `xai/backend-nodejs/` - Express + ws

## Quick Start

### 1. Choose and Start a Backend

All backends use port 8000, so you can only run one at a time.

**XAI Python Backend:**
```bash
cd xai/backend-python
./start.sh
```

**XAI Node.js Backend:**
```bash
cd xai/backend-nodejs
./start.sh
```

### 2. Start the Frontend

```bash
cd client
./start.sh
```

### 3. Open Browser

Navigate to `http://localhost:5173`

## Features

### Common to All Backends
- REST API for session management
- WebSocket proxy to voice API
- Server-side VAD (Voice Activity Detection)
- Bidirectional audio streaming
- PCM16 audio format with native sample rate support
- Health check endpoint

### Frontend Features
- Web Audio API for microphone and speaker
- Real-time audio visualization
- Debug console (excludes audio messages)
- Live conversation transcript
- Clean black/white UI
- TypeScript support

## Shared API Contract

All backends implement the same API:

### REST Endpoints
```
GET  /                      - Service info
GET  /health                - Health check
POST /sessions              - Create session
GET  /sessions              - List sessions
DELETE /sessions/:id        - Delete session
```

### WebSocket Endpoint
```
WS /ws/:session_id          - Audio streaming
```

### WebSocket Messages

**Client → Server:**
```json
{"type": "input_audio_buffer.append", "audio": "base64..."}
{"type": "input_audio_buffer.commit"}
{"type": "response.create"}
```

**Server → Client:**
- All XAI API events are forwarded
- Includes: audio, transcripts, status updates, errors

## Configuration

### Backend Environment Variables
```bash
# API key
XAI_API_KEY=your_key

# API endpoint
API_URL=wss://api.x.ai/v1/realtime

# Server configuration (same for all)
PORT=8000
VOICE=ara
INSTRUCTIONS="You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud."
```

### Frontend Environment Variables
```bash
# Backend URL (same for all backends)
VITE_API_BASE_URL=http://localhost:8000
```

## Testing Different Backends

Since the frontend is backend-agnostic, you can test different backends easily:

1. Stop current backend (Ctrl+C)
2. Start a different backend
3. Refresh the browser (frontend doesn't need restart)
4. Click START to connect to the new backend

## Audio Format

All examples use:
- **Sample Rate**: Native browser sample rate (typically 48kHz, 44.1kHz, or 24kHz) - auto-detected
- **Format**: PCM16 (16-bit signed integer)
- **Channels**: Mono
- **Transport**: Base64 encoded in JSON WebSocket messages
- **Chunk Duration**: ~100ms

**Note**: The XAI backend supports native sample rates. The frontend automatically detects the browser's native audio sample rate and configures the session accordingly, eliminating resampling overhead and improving audio quality.

## Prerequisites

### All Examples
- XAI API key
- Modern web browser with Web Audio API support

### Python Backends
- Python 3.8+
- pip and venv

### Node.js Backends
- Node.js 18+
- npm

### Frontend
- Node.js 18+
- npm

**Note**: Mobile browsers not officially supported.

