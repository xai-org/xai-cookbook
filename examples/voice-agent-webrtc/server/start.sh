#!/bin/bash

# XAI Voice WebRTC Server Start Script

echo "========================================"
echo "Starting XAI Voice WebRTC Server"
echo "========================================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your XAI_API_KEY"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful"
    echo "🚀 Starting server..."
    echo ""
    npm start
else
    echo "❌ Build failed"
    exit 1
fi

