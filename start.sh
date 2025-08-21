#!/bin/bash

# Configuration
MODE=${MODE:-"server"}
PORT=${PORT:-3000}
HTTPS_PORT=${HTTPS_PORT:-8443}

echo "🚀 Starting WebRTC Object Detection Demo"
echo "Mode: $MODE"

# Create models directory
mkdir -p models

# Check for YOLOv5s model and download if missing
if [ ! -f "models/yolov5s.onnx" ]; then
    echo "📥 Downloading YOLOv5s model (compatible float32 version)..."
    
    # Try multiple reliable sources
    if command -v wget >/dev/null 2>&1; then
        echo "Trying source 1..."
        wget -O models/yolov5s.onnx "https://github.com/ultralytics/yolov5/releases/download/v6.0/yolov5s.onnx" || \
        echo "Source 1 failed, trying source 2..." && \
        wget -O models/yolov5s.onnx "https://huggingface.co/ultralytics/yolov5/resolve/main/yolov5s.onnx" || \
        echo "Source 2 failed, trying source 3..." && \
        wget -O models/yolov5s.onnx "https://github.com/onnx/models/raw/main/validated/vision/object_detection_segmentation/yolov5/model/yolov5s.onnx"
    elif command -v curl >/dev/null 2>&1; then
        echo "Trying source 1..."
        curl -L -o models/yolov5s.onnx "https://github.com/ultralytics/yolov5/releases/download/v6.0/yolov5s.onnx" || \
        echo "Source 1 failed, trying source 2..." && \
        curl -L -o models/yolov5s.onnx "https://huggingface.co/ultralytics/yolov5/resolve/main/yolov5s.onnx" || \
        echo "Source 2 failed, trying source 3..." && \
        curl -L -o models/yolov5s.onnx "https://github.com/onnx/models/raw/main/validated/vision/object_detection_segmentation/yolov5/model/yolov5s.onnx"
    else
        echo "❌ Neither wget nor curl found. Please install one of them."
        exit 1
    fi
    
    if [ -f "models/yolov5s.onnx" ]; then
        echo "✅ Model downloaded successfully!"
        # Verify it's a valid ONNX file
        if file models/yolov5s.onnx | grep -q "data"; then
            echo "✅ Model appears to be valid"
        else
            echo "⚠️  Model file may be corrupted"
        fi
    else
        echo "❌ All download attempts failed"
        echo "Please manually download yolov5s.onnx (v6.0) and place it in the models/ folder"
        echo "You can get it from: https://github.com/ultralytics/yolov5/releases/download/v6.0/yolov5s.onnx"
        exit 1
    fi
else
    echo "✅ YOLOv5s model found"
    # Check if the existing model is valid
    if ! file models/yolov5s.onnx | grep -q "data"; then
        echo "❌ Existing model appears corrupted, removing and re-downloading..."
        rm models/yolov5s.onnx
        exit 1
    fi
fi

# Generate SSL certificates if they don't exist (for HTTPS/WebRTC)
if [ ! -f "key.pem" ] || [ ! -f "cert.pem" ]; then
    echo "🔒 Generating SSL certificates for HTTPS..."
    if command -v openssl >/dev/null 2>&1; then
        openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" >/dev/null 2>&1
        echo "✅ SSL certificates generated"
    else
        echo "⚠️  OpenSSL not found - will use HTTP (camera may not work on mobile)"
    fi
fi

echo "🎬 Starting server..."
echo "📖 Open http://localhost:$PORT in your browser"
echo "🛑 Press Ctrl+C to stop"

if [ "$MODE" = "wasm" ]; then
    echo "🌐 Running in WASM mode (client-side inference)"
else
    echo "🖥️  Running in server mode (server-side inference)"
fi

# Set environment variables and start server
export MODE=$MODE
export PORT=$PORT
export HTTPS_PORT=$HTTPS_PORT

# Check if Node.js is available
if command -v node >/dev/null 2>&1; then
    node server.js
else
    echo "❌ Node.js not found. Please install Node.js first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi