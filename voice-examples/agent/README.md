# XAI Voice Agent Examples

Complete voice agent implementations with web and telephony interfaces.

> **IMPORTANT DISCLAIMER**  
> **These are example implementations for learning and development purposes only.**  
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**  

**Required for Production:**
- Authentication and authorization (currently disabled for ease of development)
- Rate limiting on all endpoints
- Cryptographically secure session IDs 
- CORS restrictions
- Input validation and sanitization
- Comprehensive error handling
- Session expiration and cleanup
- Security headers (HSTS, CSP, etc.)
- Load testing and performance optimization
- Penetration testing

## Overview

This directory contains example voice agent implementations that demonstrate different integration patterns for building conversational AI applications.

## Available Examples

### [Web Agents](web/)

Browser-based voice agents with React frontend and Python/Node.js backends using WebSocket.

**Use Cases:**
- Customer support chat
- Virtual assistants
- Voice-enabled web applications
- Interactive demos

**Features:**
- Real-time voice streaming
- Visual transcript display
- Debug console for development
- Interchangeable backends (Python/Node.js)

**Quick Start:**
```bash
# Backend (choose one)
cd web/xai/backend-python && ./start.sh
# or
cd web/xai/backend-nodejs && ./start.sh

# Frontend (in another terminal)
cd web/client && ./start.sh

# Open http://localhost:5173
```

### [WebRTC Agents](webrtc/)

Browser-based voice agents with React frontend and Node.js WebRTC relay server.

**Use Cases:**
- Low-latency voice applications
- Quality-monitored voice chat
- NAT-traversal scenarios
- Advanced voice demos

**Features:**
- Connection quality monitoring (bitrate, jitter, packet loss, RTT)
- STUN/TURN support for NAT traversal
- DataChannel-based communication
- PCM16 audio throughout (no codec conversion)

**Quick Start:**
```bash
# Server
cd webrtc/server && ./start.sh

# Client (in another terminal)
cd webrtc/client && ./start.sh

# Open http://localhost:5173
```

### [Telephony Agent](telephony/)

Phone-based voice agents using Twilio integration.

**Use Cases:**
- IVR systems
- Call center automation
- Voice surveys
- Phone-based customer service

**Features:**
- Phone call integration
- Real-time voice processing
- Twilio Media Streams integration

**Quick Start:**
```bash
cd telephony/xai
npm install
# Configure .env with API keys and Twilio credentials
npm run dev
```

## Comparison

| Feature | Web Agents (WebSocket) | WebRTC Agents | Telephony Agents |
|---------|------------------------|---------------|------------------|
| **Interface** | Browser | Browser | Phone calls |
| **Protocol** | WebSocket | WebRTC + DataChannel | Twilio Media Streams |
| **Quality Monitoring** | No | Yes | No |
| **Deployment** | Web hosting | Web hosting | Twilio + Server |
| **Setup** | Easiest | Moderate | More complex |
| **Use Case** | Web apps, demos | Low-latency apps | Call centers, IVR |
| **Development** | Local testing easy | Local testing easy | Requires Twilio setup |
| **Cost** | API only | API only | API + Twilio minutes |
| **NAT Traversal** | N/A | STUN/TURN | N/A |

## Architecture

### Web Agent Flow (WebSocket)
```
┌─────────────┐   WebSocket   ┌─────────────┐   WebSocket   ┌─────────┐
│   Browser   │ ←───────────→ │   Backend   │ ←───────────→ │   XAI   │
│  (React)    │  Audio+Text   │  (Py/Node)  │  Audio+Text   │   API   │
└─────────────┘               └─────────────┘               └─────────┘
```

### WebRTC Agent Flow
```
┌─────────────┐      WebRTC          ┌─────────────┐   WebSocket   ┌─────────┐
│   Browser   │ ←──────────────────→ │   Server    │ ←───────────→ │   XAI   │
│  (React)    │  DataChannel (PCM16) │  (Node.js)  │  Audio+Text   │   API   │
└─────────────┘                      └─────────────┘               └─────────┘
```

### Telephony Agent Flow
```
┌─────────┐    SIP    ┌─────────┐  WebSocket  ┌──────────┐  WebSocket  ┌─────────┐
│  Phone  │ ←────────→│ Twilio  │ ←──────────→│  Server  │ ←──────────→│   XAI   │
│  Call   │           │         │             │ (Node.js)│             │   API   │
└─────────┘           └─────────┘             └──────────┘             └─────────┘
```

## Getting Started

### Prerequisites

**All Examples:**
- XAI API key from [console.x.ai](https://console.x.ai/)

**Web Agents (WebSocket):**
- Python 3.13+ or Node.js 18+
- Modern web browser

**WebRTC Agents:**
- Node.js 18+
- Chrome or Edge browser (recommended for WebRTC support)

**Telephony Agents:**
- Node.js 18+
- Twilio account ([console.twilio.com](https://console.twilio.com/))
- Public endpoint (ngrok or deployed server)

### Quick Start

1. **Choose your agent type** (web, webrtc, or telephony)
2. **Navigate to the example directory**
3. **Create a `.env` file with your API keys**
4. **Run the start script**

### Environment Setup

**Web Agents:**
```bash
cd web/xai/backend-python
# Create .env file:
echo "XAI_API_KEY=your_xai_api_key_here" > .env
./start.sh
```

**Telephony Agents:**
```bash
cd telephony/xai
# Create .env file with your credentials
npm install && npm run dev
```

## Tech Stack

### Web Agents (WebSocket)
- **Frontend**: React, TypeScript, Vite, Web Audio API
- **Backend**: FastAPI (Python) or Express (Node.js)
- **Communication**: WebSockets
- **Deployment**: Any web host + server

### WebRTC Agents
- **Frontend**: React, TypeScript, Vite, Web Audio API
- **Backend**: Express (Node.js) with werift (pure JS WebRTC)
- **Communication**: WebRTC DataChannel
- **Deployment**: Any web host + server

### Telephony Agents
- **Runtime**: Node.js + TypeScript
- **Integration**: Twilio Media Streams
- **Communication**: WebSockets
- **Deployment**: Cloud server with public endpoint

## Use Case Examples

### Web Agent Use Cases

**Customer Support:**
- Embed in your website
- 24/7 voice support
- Visual chat history
- Easy to deploy

**Virtual Assistants:**
- Task automation
- Information retrieval
- Voice commands
- Web integration

**Interactive Demos:**
- Product demonstrations
- Voice-enabled tutorials
- Proof of concepts
- Sales presentations

### Telephony Agent Use Cases

**IVR Systems:**
- Call routing
- Information gathering
- Automated responses
- Menu navigation

**Call Centers:**
- First-line support
- Call screening
- Information lookup
- Appointment scheduling

**Outbound Calls:**
- Surveys
- Notifications
- Reminders
- Follow-ups

## Documentation

- **[Web Agents Guide](web/README.md)** - Complete WebSocket web agent documentation
- **[WebRTC Agents Guide](webrtc/README.md)** - Complete WebRTC agent documentation
- **[Telephony Guide](telephony/README.md)** - Complete telephony documentation
- **[XAI API Docs](https://x.ai/api)** - Official API documentation

