# XAI Voice Web Backend - Node.js

> **IMPORTANT DISCLAIMER**
> **These are example implementations for learning and development purposes only.**
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**

Express-based WebSocket proxy server for XAI's realtime voice API. Designed for web clients with browser-based audio capture and playback.

## Features

- REST API for session management
- WebSocket proxy to XAI realtime voice API
- Server-side VAD (Voice Activity Detection)
- Bidirectional audio streaming (PCM16 with native sample rate support)
- TypeScript support
- Real-time message logging

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- XAI API key

## Quick Start

1. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your XAI_API_KEY
   ```

2. **Start the Server**
   ```bash
   ./start.sh
   ```

   The server will:
   - Install dependencies (if needed)
   - Start in development mode
   - Listen on `http://localhost:8000`

## Manual Setup

If you prefer manual setup:

```bash
# Install dependencies
npm install

# Development mode (with auto-reload)
npm run dev

# Build TypeScript
npm run build

# Production mode
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `XAI_API_KEY` | Your XAI API key (required) | - |
| `API_URL` | XAI API endpoint | `wss://api.x.ai/v1/realtime` |
| `PORT` | Server port | `8000` |
| `INSTRUCTIONS` | Bot system instructions | "You are a helpful voice assistant..." |
| `VOICE` | Voice model to use | `ara` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:3000,http://localhost:5173,http://localhost:8080` |

## API Endpoints

### REST Endpoints

#### `GET /`
Root endpoint with service information.

#### `GET /health`
Health check endpoint.
```json
{
  "status": "healthy",
  "provider": "XAI",
  "timestamp": "2025-12-03T...",
  "sessions_active": 0
}
```

#### `POST /sessions`
Create a new session.
```json
{
  "session_id": "session_123...",
  "websocket_url": "/ws/session_123..."
}
```

#### `GET /sessions`
List all active sessions.

#### `DELETE /sessions/{session_id}`
Delete a specific session.

### WebSocket Endpoint

#### `WS /ws/{session_id}`
WebSocket connection for bidirectional audio streaming.

**Client → Server Messages:**
```json
{"type": "input_audio_buffer.append", "audio": "base64_pcm16_native_rate"}
{"type": "input_audio_buffer.commit"}
{"type": "response.create"}
```

**Server → Client Messages:**
All XAI API events are forwarded to the client, including:
- `conversation.created`
- `session.updated`
- `input_audio_buffer.speech_started`
- `input_audio_buffer.speech_stopped`
- `response.output_audio.delta` - Bot audio (base64 PCM16, native sample rate)
- `response.output_audio_transcript.delta` - Bot speech transcript
- `response.created`
- `response.done`
- `error`

## Audio Format

- **Format**: PCM16
- **Sample Rate**: Native browser sample rate (typically 48kHz, 44.1kHz, or 24kHz)
- **Channels**: Mono
- **Encoding**: Base64 in WebSocket messages
- **Chunk Size**: ~100ms recommended

**Note**: The backend now supports variable sample rates. The frontend detects the browser's native sample rate and sends it during session creation. The XAI API is then configured to use that rate for both input and output audio.

## Testing

Test the server with curl:

```bash
# Health check
curl http://localhost:8000/health

# Create session
curl -X POST http://localhost:8000/sessions

# List sessions
curl http://localhost:8000/sessions
```

## Development Scripts

```bash
# Development with auto-reload
npm run dev

# Build TypeScript to dist/
npm run build

# Watch mode (auto-build)
npm run watch

# Run built version
npm start
```

## Architecture

```
Web Client (Browser)
    ↓ WebSocket
    ↓
Express Server (this)
    ↓ WebSocket
    ↓
XAI Realtime Voice API
```

## Dependencies

### Production
- `express` - Web framework
- `express-ws` - WebSocket support for Express
- `ws` - WebSocket client library
- `dotenv` - Environment variable management

### Development
- `typescript` - Type checking
- `ts-node` - TypeScript execution
- `@types/*` - Type definitions

