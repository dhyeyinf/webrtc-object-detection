#!/bin/bash

# Configuration
MODE=${MODE:-"server"}
PORT=${PORT:-3000}
HTTPS_PORT=${HTTPS_PORT:-8443}

echo "🚀 Starting WebRTC Object Detection Demo"
echo "Mode: $MODE"
echo "Port: $PORT"

# Create models directory
mkdir -p models

# Check if we have the YOLOv5s model (14MB), if not download it
if [ ! -f "models/yolov5s.onnx" ]; then
    echo "📥 Downloading YOLOv5s model..."
    echo "📥 Downloading YOLOv5s ONNX model (14MB)..."
    echo "📍 From: https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.onnx"
    echo "💾 To: $(pwd)/models/yolov5s.onnx"
    
    # Try wget first, then curl
    if command -v wget >/dev/null 2>&1; then
        if wget --progress=bar:force:noscroll -O models/yolov5s.onnx "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.onnx" 2>&1 | \
           while IFS= read -r line; do
               if [[ $line =~ ([0-9]+)%.*\[.*\].*([0-9]+[KMG]?).*([0-9]+[KMG]?) ]]; then
                   printf "\r⏳ Progress: %s (%s / %s)" "${BASH_REMATCH[1]}%" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
               fi
           done; then
            echo ""
            echo "✅ Model downloaded successfully!"
        else
            echo "❌ wget failed, trying curl..."
            curl -L --progress-bar -o models/yolov5s.onnx "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.onnx"
        fi
    else
        curl -L --progress-bar -o models/yolov5s.onnx "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.onnx"
    fi
    
    # Check download success
    if [ -f "models/yolov5s.onnx" ]; then
        size=$(stat -f%z models/yolov5s.onnx 2>/dev/null || stat -c%s models/yolov5s.onnx 2>/dev/null || echo "unknown")
        size_mb=$((size / 1024 / 1024))
        echo "📊 File size: ${size_mb}MB"
        
        if [ $size_mb -gt 10 ]; then
            echo "✅ Model size looks correct!"
        else
            echo "⚠️ Warning: Model size seems small (${size_mb}MB), expected ~14MB"
        fi
    else
        echo "❌ Failed to download model"
        exit 1
    fi
else
    size=$(stat -f%z models/yolov5s.onnx 2>/dev/null || stat -c%s models/yolov5s.onnx 2>/dev/null || echo "unknown")
    size_mb=$((size / 1024 / 1024))
    echo "✅ YOLOv5s model found (${size_mb}MB)"
fi

# Remove old yolov5n model if it exists to avoid confusion
if [ -f "models/yolov5n.onnx" ]; then
    echo "🗑️ Removing old YOLOv5n model..."
    rm models/yolov5n.onnx
fi

echo "🎬 Starting server..."
echo "📖 Open http://localhost:$PORT in your browser"
echo "🛑 Press Ctrl+C to stop"

if [ "$MODE" = "wasm" ]; then
    echo "🌐 Running in WASM mode (client-side inference)"
else
    echo "🖥️  Running in server mode (server-side inference)"
fi

# Generate SSL certificates if they don't exist
if [ ! -f "key.pem" ] || [ ! -f "cert.pem" ]; then
    echo "🔐 Generating SSL certificates for HTTPS..."
    openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" >/dev/null 2>&1
fi

echo "🔒 Starting HTTPS server for WebRTC compatibility..."

# Set environment variables and start server
export MODE=$MODE
export PORT=$PORT
export HTTPS_PORT=$HTTPS_PORT

# Start with node
if command -v node >/dev/null 2>&1; then
    node server.js
else
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi