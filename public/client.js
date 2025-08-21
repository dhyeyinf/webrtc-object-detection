// WebRTC Object Detection Client - Fixed Version
console.log('Client.js loaded - Fixed Version');

// Global variables
let socket;
let pc; // RTCPeerConnection
let localStream;
let isPhone = false;
let isProcessing = false;
let frameQueue = [];
let processedFrames = 0;
let startTime = Date.now();
let frameId = 0;
let processingPaused = false;

// DOM elements
const video = document.getElementById('remoteVideo');
const canvas = document.getElementById('overlayCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const statusElement = document.getElementById('status');

// Configuration
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize the application
async function init() {
  console.log('Initializing WebRTC client...');
  
  // Check if we have app config from server
  if (typeof window.APP_CONFIG !== 'undefined') {
    isPhone = window.APP_CONFIG.isPhone || window.APP_CONFIG.mode === 'sender';
    console.log('App config loaded:', window.APP_CONFIG);
  } else {
    // Fallback: check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    isPhone = urlParams.get('mode') === 'sender';
  }
  
  console.log('Device mode:', isPhone ? 'Phone (sender)' : 'Laptop (receiver)');
  
  // Initialize socket connection
  socket = io();
  setupSocketHandlers();
  
  if (isPhone) {
    await initializePhoneMode();
  } else {
    await initializeLaptopMode();
  }
  
  updateStatus('Ready');
}

// Phone mode: capture and send video
async function initializePhoneMode() {
  try {
    updateStatus('Starting camera...');
    
    // Get user media (camera)
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: 'environment', // Use back camera if available
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 }
      },
      audio: false
    });
    
    console.log('✅ Camera access granted');
    
    // Display local video
    video.srcObject = localStream;
    video.muted = true; // Prevent feedback
    
    // Wait for video to load
    video.onloadedmetadata = () => {
      console.log(`📹 Video loaded: ${video.videoWidth}x${video.videoHeight}`);
      video.play();
      
      // Start frame capture after video is ready
      setTimeout(() => {
        startFrameCapture();
      }, 1000);
    };
    
    // Setup WebRTC peer connection
    pc = new RTCPeerConnection(config);
    
    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log('➕ Added track:', track.kind);
    });
    
    // Setup peer connection event handlers
    setupPeerConnectionHandlers();
    
    // Create offer and send to signaling server
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
      sdp: offer,
      type: 'offer'
    });
    
    updateStatus('📡 Connecting to laptop...');
    
  } catch (error) {
    console.error('❌ Phone initialization error:', error);
    updateStatus('❌ Camera access denied: ' + error.message);
    
    // Show detailed error
    document.body.innerHTML += `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                  background: rgba(255,255,255,0.95); color: black; padding: 20px; 
                  border-radius: 10px; max-width: 90%; z-index: 1000;">
        <h3>❌ Camera Error</h3>
        <p><strong>Error:</strong> ${error.message}</p>
        <p><strong>Solutions:</strong></p>
        <ul>
          <li>Make sure you're using HTTPS (not HTTP)</li>
          <li>Allow camera permissions when prompted</li>
          <li>Try refreshing the page</li>
          <li>Check if another app is using the camera</li>
        </ul>
        <button onclick="location.reload()">🔄 Retry</button>
      </div>
    `;
  }
}

// Laptop mode: receive video and display detections
async function initializeLaptopMode() {
  try {
    updateStatus('Waiting for phone connection...');
    
    // Setup WebRTC peer connection
    pc = new RTCPeerConnection(config);
    
    // Setup peer connection event handlers
    setupPeerConnectionHandlers();
    
    // Handle incoming stream
    pc.ontrack = (event) => {
      console.log('📹 Received remote stream');
      const remoteStream = event.streams[0];
      video.srcObject = remoteStream;
      
      // Setup canvas overlay
      video.onloadedmetadata = () => {
        console.log(`📹 Remote video: ${video.videoWidth}x${video.videoHeight}`);
        if (canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        updateStatus('✅ Video stream connected - Looking for objects...');
      };
      
      video.onresize = () => {
        if (canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
      };
    };
    
    updateStatus('🔄 Ready to receive video');
    
  } catch (error) {
    console.error('❌ Laptop initialization error:', error);
    updateStatus('❌ Failed to initialize receiver: ' + error.message);
  }
}

// Setup socket event handlers
function setupSocketHandlers() {
  socket.on('connect', () => {
    console.log('🔌 Socket connected:', socket.id);
  });
  
  socket.on('offer', async (data) => {
    if (!isPhone && pc) {
      console.log('📨 Received offer');
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('answer', {
        sdp: answer,
        type: 'answer'
      });
      
      updateStatus('📡 WebRTC connection established');
    }
  });
  
  socket.on('answer', async (data) => {
    if (isPhone && pc) {
      console.log('📨 Received answer');
      await pc.setRemoteDescription(data.sdp);
      updateStatus('✅ Connected! Sending camera feed...');
    }
  });
  
  socket.on('ice-candidate', async (data) => {
    if (pc) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (error) {
        console.log('ICE candidate error:', error);
      }
    }
  });
  
  socket.on('detection-results', (data) => {
    if (!isPhone) {
      displayDetections(data);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected');
    updateStatus('❌ Disconnected from server');
  });
}

// Setup peer connection event handlers
function setupPeerConnectionHandlers() {
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate
      });
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log('🔗 Connection state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      updateStatus('✅ WebRTC connected');
    } else if (pc.connectionState === 'disconnected') {
      updateStatus('❌ WebRTC disconnected');
    } else if (pc.connectionState === 'failed') {
      updateStatus('❌ WebRTC connection failed');
    }
  };
  
  pc.onicegatheringstatechange = () => {
    console.log('🧊 ICE gathering state:', pc.iceGatheringState);
  };
}

// Start capturing frames for inference (phone mode) - FIXED VERSION
function startFrameCapture() {
  if (!isPhone || !localStream) {
    console.log('❌ Cannot start frame capture: not phone or no stream');
    return;
  }
  
  console.log('🎬 Starting frame capture...');
  
  // Create capture canvas
  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d');
  captureCanvas.width = 640;
  captureCanvas.height = 640;
  
  let frameCount = 0;
  
  function captureFrame() {
    try {
      if (processingPaused || isProcessing) {
        requestAnimationFrame(captureFrame);
        return;
      }
      
      // Check if video is ready
      if (!video.videoWidth || !video.videoHeight) {
        requestAnimationFrame(captureFrame);
        return;
      }
      
      frameCount++;
      
      // Capture frame every few frames to reduce processing load
      if (frameCount % 10 !== 0) { // Process every 10th frame (~3-6 FPS depending on device)
        requestAnimationFrame(captureFrame);
        return;
      }
      
      // Draw video frame to canvas
      captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
      
      // Convert to base64 JPEG
      const dataURL = captureCanvas.toDataURL('image/jpeg', 0.8);
      
      // Verify we got actual data
      if (dataURL && dataURL.length > 1000) {
        console.log(`📸 Captured frame ${++frameId}: ${dataURL.length} bytes`);
        
        // Prepare frame data for inference
        const frameData = {
          frameId: frameId,
          captureTs: Date.now(),
          imageData: dataURL,
          width: captureCanvas.width,
          height: captureCanvas.height
        };
        
        // Send to server for inference
        isProcessing = true;
        socket.emit('frame-data', frameData);
        
        // Update phone status
        updateStatus(`📹 Streaming (Frame ${frameId})`);
        
        // Process next frame after delay
        setTimeout(() => {
          isProcessing = false;
        }, 200); // Limit to ~5 FPS
      } else {
        console.log('⚠️ Empty or invalid frame data');
      }
      
    } catch (error) {
      console.error('❌ Frame capture error:', error);
    }
    
    requestAnimationFrame(captureFrame);
  }
  
  // Start capturing
  requestAnimationFrame(captureFrame);
  console.log('✅ Frame capture started');
}

// Display detection results (laptop mode)
function displayDetections(data) {
  if (!canvas || !ctx || !data || !data.detections) return;
  
  // Clear previous overlays
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Update metrics
  processedFrames++;
  updateMetrics();
  
  console.log(`🎯 Received ${data.detections.length} detections for frame ${data.frame_id}`);
  
  // Draw bounding boxes
  data.detections.forEach((detection, index) => {
    const { label, score, xmin, ymin, xmax, ymax } = detection;
    
    // Convert normalized coordinates to canvas coordinates
    const x1 = xmin * canvas.width;
    const y1 = ymin * canvas.height;
    const x2 = xmax * canvas.width;
    const y2 = ymax * canvas.height;
    const width = x2 - x1;
    const height = y2 - y1;
    
    console.log(`🎯 Drawing ${label} at (${x1.toFixed(0)}, ${y1.toFixed(0)}) size ${width.toFixed(0)}x${height.toFixed(0)}`);
    
    // Choose color based on object type
    let color = '#00ff00'; // Default green
    if (label === 'person') color = '#ff6b6b';
    else if (label.includes('car') || label.includes('truck')) color = '#4ecdc4';
    else if (label.includes('dog') || label.includes('cat')) color = '#45b7d1';
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, width, height);
    
    // Draw label background
    const labelText = `${label} ${(score * 100).toFixed(0)}%`;
    ctx.font = '16px Arial';
    const textMetrics = ctx.measureText(labelText);
    const textWidth = textMetrics.width;
    const textHeight = 20;
    
    ctx.fillStyle = color;
    ctx.fillRect(x1, y1 - textHeight - 5, textWidth + 10, textHeight + 5);
    
    // Draw label text
    ctx.fillStyle = 'white';
    ctx.fillText(labelText, x1 + 5, y1 - 8);
  });
  
  // Calculate and display latency
  const latency = Date.now() - data.capture_ts;
  updateLatencyDisplay(latency);
  
  // Update status with detection count
  if (data.detections.length > 0) {
    const objects = data.detections.map(d => d.label).join(', ');
    updateStatus(`🎯 Detected: ${objects}`);
  } else {
    updateStatus('👀 Looking for objects...');
  }
}

// Update status display
function updateStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
  console.log('📱 Status:', message);
}

// Update metrics display
function updateMetrics() {
  const metricsElement = document.getElementById('metrics');
  if (!metricsElement) return;
  
  const elapsed = (Date.now() - startTime) / 1000;
  const fps = processedFrames / elapsed;
  const queueSize = frameQueue.length;
  
  metricsElement.innerHTML = `
    <div>Processed Frames: ${processedFrames}</div>
    <div>FPS: ${fps.toFixed(2)}</div>
    <div>Queue Size: ${queueSize}</div>
    <div>Mode: ${isPhone ? 'phone' : 'laptop'}</div>
  `;
}

// Update latency display
function updateLatencyDisplay(latency) {
  const metricsElement = document.getElementById('metrics');
  if (metricsElement) {
    const currentContent = metricsElement.innerHTML;
    const latencyColor = latency < 500 ? '#00ff00' : latency < 1000 ? '#ffff00' : '#ff0000';
    metricsElement.innerHTML = currentContent + `<div style="color: ${latencyColor}">Latency: ${latency}ms</div>`;
  }
}

// Handle window resize
window.addEventListener('resize', () => {
  if (video && video.videoWidth && video.videoHeight && canvas) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('📄 DOM loaded, initializing...');
  init().catch(error => {
    console.error('❌ Initialization error:', error);
    updateStatus('❌ Failed to initialize: ' + error.message);
  });
});

// Export functions for global access
window.updateStatus = updateStatus;
window.updateMetrics = updateMetrics;