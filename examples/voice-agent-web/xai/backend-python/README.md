# XAI Voice Web Backend - Python

> **IMPORTANT DISCLAIMER**
> **These are example implementations for learning and development purposes only.**
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**

FastAPI-based WebSocket proxy server for XAI's realtime voice API. Designed for web clients with browser-based audio capture and playback.

## Features

- REST API for session management
- WebSocket proxy to XAI realtime voice API
- Server-side VAD (Voice Activity Detection)
- Bidirectional audio streaming (PCM16 with native sample rate support)
- Real-time message logging

## Prerequisites

- Python 3.8 or higher
- XAI API key
- Virtual environment (created automatically by start script)

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
   - Create a virtual environment (if needed)
   - Install dependencies
   - Start on `http://localhost:8000`

## Manual Setup

If you prefer manual setup:

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start server
python main.py
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
  "session_id": "uuid",
  "websocket_url": "/ws/{session_id}"
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
- `response.output_audio.delta` - Bot audio (base64 PCM16 at native sample rate)
- `response.output_audio_transcript.delta` - Bot speech transcript
- `response.created`
- `response.done`
- `error`

## Audio Format

- **Format**: PCM16
- **Sample Rate**: Native browser sample rate (auto-detected, typically 48kHz, 44.1kHz, or 24kHz)
- **Channels**: Mono
- **Encoding**: Base64 in WebSocket messages
- **Chunk Size**: ~100ms recommended

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

## Development

To enable auto-reload during development, edit `main.py`:

```python
uvicorn.run(
    "main:app",
    host="0.0.0.0",
    port=PORT,
    log_level="info",
    reload=True,  # Enable auto-reload
)
```

## Architecture

```
Web Client (Browser)
    ↓ WebSocket
    ↓
FastAPI Server (this)
    ↓ WebSocket
    ↓
XAI Realtime Voice API
```

## Dependencies

- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `websockets` - WebSocket client library
- `python-dotenv` - Environment variable management

