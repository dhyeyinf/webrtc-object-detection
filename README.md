# WebRTC Real-time Object Detection Demo

A real-time multi-object detection system that streams video from a phone via WebRTC to a browser, performs inference, and overlays detection results with minimal latency.

## 🚀 Quick Start (One Command)

```bash
git clone <your-repo-url>
cd webrtc-object-detection
chmod +x start.sh
./start.sh
```

**Or with Docker:**
```bash
docker-compose up --build
```

## 📱 Phone Connection Instructions

1. Start the server (see above)
2. Open http://localhost:3000 in your laptop browser
3. Scan the QR code with your phone's camera app
4. Allow camera access when prompted
5. You should see live video with object detection overlays

**If your phone can't connect directly:**
```bash
./start.sh --ngrok
```
Then use the provided public URL.

## 🔧 Mode Switching

### Server Mode (Default - GPU/CPU intensive)
```bash
MODE=server ./start.sh
# or
./start.sh --server
```

### WASM Mode (Low-resource, client-side inference)
```bash
MODE=wasm ./start.sh
# or  
./start.sh --wasm
```

## 📊 Benchmarking

Run a 30-second benchmark:
```bash
chmod +x bench/run_bench.sh
./bench/run_bench.sh --duration 30 --mode server
```

This generates `metrics.json` with:
- Median & P95 end-to-end latency
- Processed FPS
- System resource usage
- Network bandwidth estimates

## 🐳 Docker Usage

### Development
```bash
docker-compose up --build
```

### Production with SSL
```bash
docker-compose --profile production up --build
```

### Custom configuration
```bash
MODE=wasm docker-compose up --build
```

## 🏗️ Architecture & Design Choices

### WebRTC Pipeline
```
Phone Camera → WebRTC → Browser → Frame Extraction → Inference → Overlay Rendering
```

### Two Inference Modes

1. **Server Mode**: 
   - Server-side inference using ONNX Runtime
   - Higher accuracy, supports larger models
   - Requires decent CPU/GPU on server
   - ~100-200ms latency

2. **WASM Mode**:
   - Client-side inference using onnxruntime-web
   - Lower latency (~50-100ms)
   - Runs on modest hardware
   - Limited to smaller, quantized models

### Low-Resource Optimizations

- **Frame Downscaling**: Input resized to 320×240 for processing
- **Adaptive Sampling**: Processes 10-15 FPS instead of full 30 FPS  
- **Frame Queue Management**: Backpressure with max 3-frame queue
- **Model Quantization**: Uses YOLOv5n (lightweight variant)

### Backpressure Policy

1. **Queue Limiting**: Max 3 frames in processing queue
2. **Frame Dropping**: Drops oldest frames when overloaded
3. **Adaptive Rate**: Reduces processing FPS under high CPU load
4. **Browser Optimization**: Pauses when tab is hidden

## 🔧 Troubleshooting

### Connection Issues
```bash
# Check if server is running
curl http://localhost:3000/health

# Use ngrok for NAT traversal  
./start.sh --ngrok

# Check WebRTC connection
# Open Chrome DevTools → go to chrome://webrtc-internals
```

### Performance Issues
```bash
# Switch to low-resource mode
./start.sh --wasm

# Reduce resolution (edit client.js)
# Change targetWidth/Height to 240×180

# Monitor system resources
htop  # or top
```

### Frame Alignment Issues
- Ensure `capture_ts` timestamps are consistent
- Check browser console for WebRTC errors
- Verify camera permissions are granted

## 📈 Expected Performance

### Server Mode (Intel i5, 8GB RAM)
- **Latency**: 150-300ms median, 400-600ms P95
- **FPS**: 8-12 processed FPS
- **CPU**: 60-80% during processing
- **Memory**: ~200-400MB

### WASM Mode (Same hardware)
- **Latency**: 80-150ms median, 200-350ms P95  
- **FPS**: 10-15 processed FPS
- **CPU**: 40-60% during processing
- **Memory**: ~150-250MB

## 🛠️ Development

### Project Structure
```
├── server.js              # Main server with WebRTC signaling
├── public/
│   ├── client.js          # Frontend WebRTC + inference client  
│   └── index.html         # UI with video overlay canvas
├── models/
│   └── yolov5n.onnx      # YOLOv5 nano model (auto-downloaded)
├── bench/
│   └── run_bench.sh      # Benchmarking script
├── docker-compose.yml    # Container orchestration
├── Dockerfile           # Production container
└── start.sh            # Convenience startup script
```

### Key Dependencies
- **express**: Web server
- **socket.io**: WebRTC signaling  
- **onnxruntime-node**: Server-side inference
- **onnxruntime-web**: Client-side WASM inference
- **qrcode**: Phone connection QR codes

### Adding New Models

1. Place ONNX model in `models/` directory
2. Update class names in `server.js`
3. Adjust input dimensions in preprocessing
4. Update model path in initialization

## 🔮 Next Improvements

**One-line improvement**: Implement WebRTC DataChannel for direct inference results instead of Socket.IO to reduce latency by ~20-50ms.

**Other potential improvements**:
- Add pose estimation models (PoseNet, MediaPipe)
- Implement model switching via UI
- Add recording/playback functionality  
- GPU acceleration with WebGL/WebGPU
- Multi-person tracking with DeepSORT
- Real-time performance metrics dashboard

## 📝 System Requirements

### Minimum (WASM Mode)
- **CPU**: Intel i3 or equivalent
- **RAM**: 4GB
- **Browser**: Chrome 88+, Safari 14+
- **Network**: Wi-Fi (same network as phone)

### Recommended (Server Mode)  
- **CPU**: Intel i5 or equivalent
- **RAM**: 8GB+
- **GPU**: Optional (CUDA support planned)
- **Network**: Wi-Fi or LAN

## 📄 License

MIT License - feel free to use for learning and development.

---

*Built for real-time computer vision applications with WebRTC streaming.*