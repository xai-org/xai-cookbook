#!/bin/bash

# XAI Voice Telephony Backend - Twilio Integration Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "XAI Voice Telephony Backend"
echo "Twilio Integration"
echo "=================================="

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo "⚠️  Please edit .env and add your XAI_API_KEY and HOSTNAME"
    else
        echo "Creating empty .env file..."
        cat > .env << 'EOF'
# XAI API Configuration
XAI_API_KEY=your_xai_api_key_here

# Server Configuration
PORT=3000

# Hostname (your ngrok or public URL, e.g., https://abc123.ngrok.io)
HOSTNAME=https://your-ngrok-url.ngrok.io
EOF
        echo "⚠️  Please edit .env and add your XAI_API_KEY and HOSTNAME"
    fi
    exit 1
fi

# Check for node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the server in development mode
echo "🚀 Starting XAI Voice Telephony Backend..."
echo "📡 Server will be available at http://localhost:${PORT:-3000}"
echo "📊 Health check: http://localhost:${PORT:-3000}/health"
echo ""
echo "📞 Configure your Twilio webhook to:"
echo "   Voice URL: \$HOSTNAME/twiml"
echo "   Status URL: \$HOSTNAME/call-status"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev

