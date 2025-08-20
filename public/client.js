// client.js - Enhanced WebRTC client with object detection
const socket = io();
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
});

// DOM elements
const video = document.getElementById('remoteVideo');
const canvas = document.getElementById('overlayCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const metricsDiv = document.getElementById('metrics');

// Configuration
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'receiver';
const inferenceMode = urlParams.get('inference') || 'server'; // 'server' or 'wasm'

// State
let dataChannel = null;
let localStream = null;
let isProcessing = false;
let frameQueue = [];
let maxQueueSize = 3; // Backpressure: keep only latest frames
let processedFrames = 0;
let startTime = Date.now();
let ortSession = null;

// Initialize ONNX Runtime for WASM mode
async function initializeWASM() {
  if (inferenceMode === 'wasm') {
    try {
      // Configure ONNX Runtime for WASM
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/';
      
      // Load model (you'd need to serve the model file)
      ortSession = await ort.InferenceSession.create('/models/yolov5n.onnx');
      console.log('WASM model loaded successfully');
      updateStatus('WASM model loaded');
    } catch (error) {
      console.error('Failed to load WASM model:', error);
      updateStatus('Failed to load WASM model, falling back to server mode');
    }
  }
}

// Update status display
function updateStatus(message) {
  if (statusDiv) {
    statusDiv.textContent = `Status: ${message}`;
  }
  console.log(message);
}

// Update metrics display
function updateMetrics() {
  if (metricsDiv && processedFrames > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const fps = processedFrames / elapsed;
    metricsDiv.innerHTML = `
      <div>Processed Frames: ${processedFrames}</div>
      <div>FPS: ${fps.toFixed(2)}</div>
      <div>Queue Size: ${frameQueue.length}</div>
      <div>Mode: ${inferenceMode}</div>
    `;
  }
}

// Sender mode (phone)
if (mode === 'sender') {
  updateStatus('Requesting camera access...');
  
  navigator.mediaDevices.getUserMedia({ 
    video: { 
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 15, max: 30 }
    } 
  }).then(stream => {
    localStream = stream;
    
    // Add track to peer connection
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });
    
    // Show local video
    const localVideo = document.createElement('video');
    localVideo.srcObject = stream;
    localVideo.autoplay = true;
    localVideo.muted = true;
    localVideo.style.position = 'fixed';
    localVideo.style.bottom = '10px';
    localVideo.style.right = '10px';
    localVideo.style.width = '200px';
    localVideo.style.border = '2px solid white';
    document.body.appendChild(localVideo);
    
    updateStatus('Camera ready, creating offer...');
    
    pc.createOffer().then(offer => {
      return pc.setLocalDescription(offer);
    }).then(() => {
      socket.emit('offer', pc.localDescription);
      updateStatus('Offer sent, waiting for connection...');
    });
  }).catch(error => {
    console.error('Camera access error:', error);
    updateStatus('Camera access denied or failed');
  });
} else {
  // Receiver mode (laptop/desktop)
  updateStatus('Waiting for phone connection...');
  
  // Load QR code
  fetch('/qr')
    .then(res => res.text())
    .then(html => {
      document.body.insertAdjacentHTML('beforeend', html);
    });
}

// WebRTC event handlers
pc.ontrack = (event) => {
  console.log('Received remote track');
  video.srcObject = new MediaStream([event.track]);
  updateStatus('Video stream received');
  
  video.onloadedmetadata = () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
    
    if (mode === 'receiver') {
      startFrameProcessing();
    }
  };
};

pc.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit('ice-candidate', event.candidate);
  }
};

pc.onconnectionstatechange = () => {
  updateStatus(`Connection: ${pc.connectionState}`);
  if (pc.connectionState === 'connected') {
    updateStatus('WebRTC connection established');
  }
};

// Socket event handlers
socket.on('offer', async (offer) => {
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', answer);
  updateStatus('Answer sent');
});

socket.on('answer', async (answer) => {
  await pc.setRemoteDescription(answer);
  updateStatus('Connection established');
});

socket.on('ice-candidate', async (candidate) => {
  try {
    await pc.addIceCandidate(candidate);
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
});

// Handle detection results
socket.on('detection-results', (data) => {
  drawOverlays(data.detections, data.frame_id, data.capture_ts);
  processedFrames++;
  updateMetrics();
});

// Frame processing for receiver
function startFrameProcessing() {
  if (mode !== 'receiver') return;
  
  updateStatus('Starting frame processing...');
  
  // Initialize WASM if needed
  initializeWASM();
  
  const processFrame = () => {
    if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessing) {
      captureAndProcessFrame();
    }
    
    // Maintain processing rate (10-15 FPS for low-resource mode)
    const targetFPS = 12;
    setTimeout(processFrame, 1000 / targetFPS);
  };
  
  processFrame();
}

// Capture frame and send for processing
function captureAndProcessFrame() {
  if (isProcessing || !video.videoWidth || !video.videoHeight) return;
  
  isProcessing = true;
  
  try {
    // Create temporary canvas for frame capture
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // Scale down for performance (320x240 for low-resource mode)
    const targetWidth = 320;
    const targetHeight = 240;
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    
    // Draw and capture frame
    tempCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
    
    if (inferenceMode === 'wasm' && ortSession) {
      // Process locally with WASM
      processFrameWASM(tempCanvas, targetWidth, targetHeight);
    } else {
      // Send to server for processing
      processFrameServer(tempCanvas, targetWidth, targetHeight);
    }
  } catch (error) {
    console.error('Frame capture error:', error);
    isProcessing = false;
  }
}

// Server-side processing
function processFrameServer(canvas, width, height) {
  const frameId = Date.now().toString();
  const captureTs = Date.now();
  
  // Convert canvas to image data
  canvas.toBlob(blob => {
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = reader.result.split(',')[1]; // Remove data:image/png;base64,
      
      // Add to queue with backpressure
      if (frameQueue.length >= maxQueueSize) {
        frameQueue.shift(); // Remove oldest frame
      }
      
      frameQueue.push({
        frameId,
        captureTs,
        imageData,
        width,
        height
      });
      
      // Process queue
      if (frameQueue.length > 0) {
        const frame = frameQueue.shift();
        socket.emit('frame-data', frame);
      }
      
      isProcessing = false;
    };
    reader.readAsDataURL(blob);
  }, 'image/jpeg', 0.8);
}

// WASM-side processing (simplified - would need full implementation)
async function processFrameWASM(canvas, width, height) {
  try {
    // This is a simplified version - full WASM implementation would need
    // proper image preprocessing, tensor conversion, etc.
    const frameId = Date.now().toString();
    const captureTs = Date.now();
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Mock detection results for demo
    const mockDetections = [
      {
        label: 'person',
        score: 0.85,
        xmin: 0.2,
        ymin: 0.1,
        xmax: 0.6,
        ymax: 0.8
      }
    ];
    
    drawOverlays(mockDetections, frameId, captureTs);
    processedFrames++;
    updateMetrics();
    
  } catch (error) {
    console.error('WASM processing error:', error);
  } finally {
    isProcessing = false;
  }
}

// Draw detection overlays
function drawOverlays(detections, frameId, captureTs) {
  if (!ctx || !canvas.width || !canvas.height) return;
  
  // Clear previous overlays
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw each detection
  detections.forEach(det => {
    const x = det.xmin * canvas.width;
    const y = det.ymin * canvas.height;
    const width = (det.xmax - det.xmin) * canvas.width;
    const height = (det.ymax - det.ymin) * canvas.height;
    
    // Draw bounding box
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    
    // Draw label background
    const label = `${det.label} (${(det.score * 100).toFixed(0)}%)`;
    ctx.font = '14px Arial';
    const textMetrics = ctx.measureText(label);
    const textHeight = 16;
    
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.fillRect(x, y - textHeight - 2, textMetrics.width + 4, textHeight + 2);
    
    // Draw label text
    ctx.fillStyle = 'white';
    ctx.fillText(label, x + 2, y - 4);
  });
  
  // Calculate and display latency
  if (captureTs) {
    const latency = Date.now() - captureTs;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 120, 20);
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.fillText(`Latency: ${latency}ms`, 15, 25);
  }
}

// Initialize metrics update interval
setInterval(updateMetrics, 1000);

// Handle page visibility for performance
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause processing when tab is hidden
    isProcessing = true;
  } else {
    // Resume processing
    isProcessing = false;
  }
});