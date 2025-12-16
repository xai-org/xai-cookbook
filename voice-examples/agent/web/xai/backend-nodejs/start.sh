#!/bin/bash

# XAI Voice Web Backend - Node.js Server Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "XAI Voice Web Backend (Node.js)"
echo "=================================="

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your XAI_API_KEY"
    exit 1
fi

# Check for node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the server in development mode
echo "🚀 Starting XAI Voice Web Backend (Node.js)..."
echo "📡 Server will be available at http://localhost:8000"
echo "📊 Health check: http://localhost:8000/health"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev

