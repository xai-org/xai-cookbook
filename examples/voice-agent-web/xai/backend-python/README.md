# XAI Voice Web Backend - Python

> **IMPORTANT DISCLAIMER**
> **These are example implementations for learning and development purposes only.**
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**

FastAPI server that mints ephemeral tokens so web clients can connect directly to XAI's realtime voice API. This backend does not proxy audio or WebSocket traffic; the browser opens the realtime connection itself using the short-lived token.

## Features

- REST API that issues ephemeral session tokens
- Direct client-to-XAI connection (no server-side audio or WebSocket proxying)
- Per-IP rate limiting on session creation
- CORS restricted to configured origins

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
| `PORT` | Server port | `8000` |
| `INSTRUCTIONS` | Bot system instructions | "You are a helpful voice assistant..." |
| `VOICE` | Voice model to use | `ara` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:3000,http://localhost:5173,http://localhost:8080` |

## API Endpoints

#### `GET /`
Root endpoint with service information.

#### `GET /health`
Health check endpoint.
```json
{
  "status": "healthy",
  "provider": "XAI",
  "timestamp": "2025-12-03T..."
}
```

#### `POST /session`
Mint an ephemeral token for a direct client-to-XAI realtime connection. Rate limited to 10 requests per minute per IP. Takes no request body.
```json
{
  "client_secret": {
    "value": "ephemeral-token",
    "expires_at": 1733250000
  },
  "voice": "ara",
  "instructions": "You are a helpful voice assistant..."
}
```
The client uses `client_secret.value` to open the realtime connection directly to XAI. The `voice` and `instructions` fields echo the server configuration so the frontend can apply them.

## Testing

Test the server with curl:

```bash
# Health check
curl http://localhost:8000/health

# Create an ephemeral session token
curl -X POST http://localhost:8000/session
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
    │  1. POST /session  →  FastAPI Server (this)  →  XAI client_secrets API
    │                                                       ↓ ephemeral token
    │  2. WebSocket (direct, using ephemeral token)
    ↓
XAI Realtime Voice API
```

## Dependencies

- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `httpx` - Async HTTP client used to request ephemeral tokens from XAI
- `slowapi` - Rate limiting
- `python-dotenv` - Environment variable management

