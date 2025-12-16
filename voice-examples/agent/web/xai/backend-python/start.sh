#!/bin/bash

# XAI Voice Web Backend - Python Server Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "XAI Voice Web Backend (Python)"
echo "=================================="

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your XAI_API_KEY"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Use the venv's Python directly
PYTHON="./venv/bin/python"

# Install/upgrade dependencies
echo "📥 Installing dependencies..."
$PYTHON -m pip install -q --upgrade pip
$PYTHON -m pip install -q -r requirements.txt

# Start the server
echo "🚀 Starting XAI Voice Web Backend..."
echo "📡 Server will be available at http://localhost:8000"
echo "📊 Health check: http://localhost:8000/health"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

$PYTHON main.py

