#!/bin/bash

# XAI Voice Web Client - Frontend Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "XAI Voice Web Client"
echo "=================================="

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Created .env file with default backend URL"
fi

# Check for node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the development server
echo "🚀 Starting XAI Voice Web Client..."
echo "📡 Frontend will be available at http://localhost:5173"
echo "🔗 Make sure a backend is running on http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev

