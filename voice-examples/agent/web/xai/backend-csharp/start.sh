#!/bin/bash
#
# Start script for XAI Voice Web Backend (C#)
# Restores NuGet packages and starts the ASP.NET Core server.
#

set -e

echo "🚀 Starting XAI Voice Web Backend (C#)..."

# Check if .NET SDK is installed
if ! command -v dotnet &> /dev/null; then
    echo "❌ .NET SDK not found. Please install .NET 10.0 SDK or higher."
    echo "   Download from: https://dotnet.microsoft.com/download"
    exit 1
fi

DOTNET_VERSION=$(dotnet --version)
echo "✅ .NET SDK version: $DOTNET_VERSION"

# Check for XAI_API_KEY
if [ -z "$XAI_API_KEY" ]; then
    echo "⚠️  WARNING: XAI_API_KEY environment variable not set!"
    echo "   Set it with: export XAI_API_KEY='your-api-key'"
fi

# Restore packages
echo "📦 Restoring NuGet packages..."
dotnet restore

# Build and run
echo "🔨 Building and starting server..."
dotnet run

