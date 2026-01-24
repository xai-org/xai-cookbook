#!/bin/bash

# XAI Voice Web Backend (LFM-Enhanced) Start Script
# COPYRIGHT © 2025 KEITH LUTON. ALL RIGHTS RESERVED.

echo "========================================"
echo "Starting XAI Voice Web Backend (Python)"
echo "COPYRIGHT © 2025 KEITH LUTON"
echo "========================================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your XAI_API_KEY"
    echo ""
fi

# Check for venv
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv and install dependencies
source venv/bin/activate
echo "📦 Installing/Updating dependencies..."
pip install -r requirements.txt

# Start server
echo "🚀 Starting server..."
python main.py
