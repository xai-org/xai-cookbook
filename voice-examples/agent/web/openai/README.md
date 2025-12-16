# OpenAI Web Backends

Two backend implementations for OpenAI's realtime voice API, both exposing the same REST and WebSocket API.

## Backends

### Python Backend
**Location**: `backend-python/`

- **Framework**: FastAPI + uvicorn
- **WebSocket**: websockets library
- **Language**: Python 3.8+
- **Start**: `./start.sh`

### Node.js Backend
**Location**: `backend-nodejs/`

- **Framework**: Express + express-ws
- **WebSocket**: ws library
- **Language**: TypeScript/Node.js 18+
- **Start**: `./start.sh`

## Features (Both Backends)

- REST API for session management
- WebSocket proxy to OpenAI realtime voice API
- Server-side VAD (Voice Activity Detection)
- Bidirectional audio streaming
- Session lifecycle management
- Health check endpoint
- Real-time message logging

## Quick Start

### Python Backend

```bash
cd backend-python
./start.sh
```

### Node.js Backend

```bash
cd backend-nodejs
./start.sh
```

Both backends will start on port 8000.

## Configuration

Both backends use the same environment variables:

```bash
# OpenAI API Key (required)
OPENAI_API_KEY=your_openai_api_key_here

# API Endpoint
API_URL=wss://api.x.ai/v1/realtime

# Server Port
PORT=8000

# Bot Configuration
VOICE=ara
INSTRUCTIONS="You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud."

# CORS Configuration (optional)
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173,http://localhost:8080"
```

## API Endpoints

Both backends implement the same API contract:

### REST Endpoints

- `GET /` - Service information
- `GET /health` - Health check and status
- `POST /sessions` - Create new session
- `GET /sessions` - List active sessions
- `DELETE /sessions/{id}` - Delete session

### WebSocket Endpoint

- `WS /ws/{session_id}` - Bidirectional audio streaming

## Testing

Test backend health:
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "provider": "OpenAI",
  "timestamp": "2025-12-03T...",
  "sessions_active": 0
}
```

## Choosing Between Python and Node.js

### Choose Python if:
- You're more comfortable with Python
- You want FastAPI's automatic API documentation
- You prefer Python's async/await syntax
- Your team already uses Python

### Choose Node.js if:
- You're more comfortable with JavaScript/TypeScript
- You want faster startup time
- You prefer Node.js ecosystem
- Your team already uses Node.js

**Performance**: Both backends have similar performance characteristics for this use case.

## Frontend Integration

Both backends work seamlessly with the web client in `../client/`:

```bash
# Terminal 1: Start backend
cd backend-python  # or backend-nodejs
./start.sh

# Terminal 2: Start frontend
cd ../client
./start.sh
```

