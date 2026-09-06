#!/bin/bash

# XAI Voice Telephony Backend - Plivo Integration Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "XAI Voice Telephony Backend"
echo "Plivo Integration"
echo "=================================="

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo "⚠️  Please edit .env and add your XAI_API_KEY, HOSTNAME, and Plivo credentials"
    else
        echo "Creating empty .env file..."
        cat > .env << 'EOF'
# XAI API Configuration
XAI_API_KEY=your_xai_api_key_here

# Server Configuration
PORT=3000

# Hostname (your ngrok or public URL, e.g., https://abc123.ngrok.io)
HOSTNAME=https://your-ngrok-url.ngrok.io

PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=
EOF
        echo "⚠️  Please edit .env and add your XAI_API_KEY, HOSTNAME, and Plivo credentials"
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
echo "📞 Configure your Plivo webhook to:"
echo "   Voice URL: \$HOSTNAME/answer"
echo "   Status URL: \$HOSTNAME/hangup"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev

