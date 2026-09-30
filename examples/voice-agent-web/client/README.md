# XAI Voice Web Client

React-based web client for XAI's realtime voice API. Features a sleek black UI with real-time audio streaming, debug console, and conversation transcript.

## Features

- Real-time voice interaction via Web Audio API
- WebSocket connection to backend (Python or Node.js)
- Debug console showing all WebSocket messages (excluding audio)
- Live conversation transcript
- Microphone level indicator
- TypeScript support

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- A running backend server (see backends in `../xai/`)

## Quick Start

1. **Start a Backend**
   
   Choose ONE backend to start (all use port 8000):
   ```bash
   # XAI Python
   cd ../xai/backend-python && ./start.sh

   # XAI Node.js
   cd ../xai/backend-nodejs && ./start.sh
   ```

2. **Start the Frontend**
   ```bash
   ./start.sh
   ```

3. **Open Browser**
   
   Navigate to `http://localhost:5173`

## Manual Setup

If you prefer manual setup:

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Configuration

Create a `.env` file (or use `.env.example`):

```bash
# Backend API URL
VITE_API_BASE_URL=http://localhost:8000
```

**Note**: All backends use port 8000, so you don't need to change this setting when switching between backends.

## Usage

1. **Start Conversation**
   - Click the green "START" button
   - Allow microphone access when prompted
   - The bot will greet you automatically

2. **Talk to the Bot**
   - Speak naturally into your microphone
   - The bot uses server-side Voice Activity Detection (VAD)
   - Your speech will be transcribed and shown in the Transcript panel
   - The bot's responses will play through your speakers

3. **Monitor Activity**
   - **Microphone Level**: Visual indicator shows your audio input level
   - **Debug Console**: Shows all non-audio WebSocket messages
   - **Transcript**: Displays the conversation history

4. **Stop Conversation**
   - Click the red "STOP" button
   - This disconnects the WebSocket and stops audio capture

## UI Components

### Top Bar
- **Title**: "XAI Voice Demo"
- **Connection Status**: Green dot = connected, Red dot = disconnected

### Control Panel
- **START Button**: Initiates connection and audio capture
- **STOP Button**: Disconnects and stops capture
- **Status**: Shows current state (Not connected, Connected, Recording)
- **Microphone Level**: Visual bar showing audio input level

### Transcript Panel
- Shows conversation history
- **USER**: Messages you spoke (green)
- **ASSISTANT**: Bot responses (cyan)
- Auto-scrolls to latest message
- Timestamps for each message

### Debug Console
- Shows all WebSocket messages (excluding audio data)
- **SEND**: Messages sent to backend (yellow)
- **RECV**: Messages received from backend (cyan)
- JSON formatted for readability
- Auto-scrolls to latest message

## Architecture

```
Browser (This Client)
    ↓ WebSocket
    ↓
Backend (Python or Node.js)
    ↓ WebSocket
    ↓
XAI API
```

## Audio Format

- **Sample Rate**: Native browser sample rate (auto-detected, typically 48kHz, 44.1kHz, or 24kHz)
- **Format**: PCM16
- **Channels**: Mono
- **Encoding**: Base64 in WebSocket messages
- **Chunk Size**: ~100ms

**Native Sample Rate Support**: The client automatically detects the browser's native audio sample rate using the Web Audio API and sends it to the backend during session creation. This eliminates the need for resampling and provides optimal audio quality.
