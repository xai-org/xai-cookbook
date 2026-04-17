# XAI Voice Web Backend - C#

> **IMPORTANT DISCLAIMER**
> **These are example implementations for learning and development purposes only.**
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**

ASP.NET Core-based server for XAI's realtime voice API. Provides ephemeral tokens for direct client-to-XAI connections.

## Features

- REST API for session management
- Direct WebSocket proxy to XAI realtime voice API
- Ephemeral token generation for direct XAI API connection
- Rate limiting (10 requests/minute on session endpoint)
- CORS support for web clients

## Prerequisites

- .NET 10.0 SDK or higher
- XAI API key

## Quick Start

1. **Configure Environment**
   ```bash
   export XAI_API_KEY="your-api-key-here"
   ```

2. **Start the Server**
   ```bash
   ./start.sh
   ```

   The server will:
   - Restore NuGet packages
   - Build and start on `http://localhost:8000`

## Manual Setup

If you prefer manual setup:

```bash
# Restore packages and build
dotnet restore
dotnet build

# Start server
dotnet run
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

### REST Endpoints

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
Get ephemeral token for direct XAI API connection.
```json
{
  "client_secret": {
    "value": "ephemeral-token",
    "expires_at": 1234567890
  },
  "voice": "ara",
  "instructions": "You are a helpful voice assistant..."
}
```

## Testing

Test the server with curl:

```bash
# Health check
curl http://localhost:8000/health

# Create session
curl -X POST http://localhost:8000/session
```

## Architecture

```
Web Client (Browser)
    ↓ Direct WebSocket (using ephemeral token)
    ↓
XAI Realtime Voice API
```

## Dependencies

- `AspNetCoreRateLimit` - Rate limiting middleware

