#!/bin/bash

# WebRTC Object Detection Start Script
set -e

# Default configuration
MODE=${MODE:-"server"}
PORT=${PORT:-3000}
USE_NGROK=false
NGROK_URL=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --ngrok)
      USE_NGROK=true
      shift
      ;;
    --wasm)
      MODE="wasm"
      shift
      ;;
    --server)
      MODE="server"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --mode <server|wasm>    Set inference mode (default: server)"
      echo "  --port <port>           Set port number (default: 3000)"
      echo "  --ngrok                 Use ngrok for public access"
      echo "  --wasm                  Use WASM mode (client-side inference)"
      echo "  --server                Use server mode (server-side inference)"
      echo "  -h, --help              Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🚀 Starting WebRTC Object Detection Demo"
echo "Mode: $MODE"
echo "Port: $PORT"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Download model if it doesn't exist
if [ ! -f "models/yolov5n.onnx" ]; then
    echo "📥 Downloading YOLOv5 model..."
    mkdir -p models
    if [ -f "download_model.js" ]; then
        node download_model.js
    else
        echo "⚠️  download_model.js not found. Please ensure the model is available."
    fi
fi

# Start ngrok if requested
if [ "$USE_NGROK" = true ]; then
    echo "🌐 Starting ngrok..."
    
    # Check if ngrok is installed
    if ! command -v ngrok &> /dev/null; then
        echo "❌ ngrok is not installed. Please install ngrok or run without --ngrok flag."
        echo "   Visit: https://ngrok.com/download"
        exit 1
    fi
    
    # Kill any existing ngrok processes
    pkill ngrok || true
    sleep 2
    
    # Start ngrok in background
    ngrok http $PORT --log=stdout > ngrok.log 2>&1 &
    NGROK_PID=$!
    
    # Wait for ngrok to start and get URL
    echo "⏳ Waiting for ngrok to initialize..."
    sleep 5
    
    # Extract ngrok URL
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*https[^"]*"' | grep -o 'https[^"]*' | head -1)
    
    if [ -n "$NGROK_URL" ]; then
        echo "✅ ngrok started successfully"
        echo "📱 Public URL: $NGROK_URL"
        export NGROK_URL="$NGROK_URL"
    else
        echo "❌ Failed to get ngrok URL. Check ngrok.log for details."
        kill $NGROK_PID || true
        exit 1
    fi
    
    # Cleanup function
    cleanup() {
        echo "🧹 Cleaning up..."
        kill $NGROK_PID || true
        pkill ngrok || true
        exit
    }
    
    # Set trap to cleanup on script exit
    trap cleanup EXIT INT TERM
fi

# Set environment variables
export MODE="$MODE"
export PORT="$PORT"

# Start the server
echo "🎬 Starting server..."
echo "📖 Open http://localhost:$PORT in your browser"
if [ -n "$NGROK_URL" ]; then
    echo "📱 Or scan QR code with your phone to connect"
fi
echo "🛑 Press Ctrl+C to stop"

# Start server with appropriate mode
if [ "$MODE" = "wasm" ]; then
    echo "🧠 Running in WASM mode (client-side inference)"
else
    echo "🖥️  Running in server mode (server-side inference)"
fi

node server.js