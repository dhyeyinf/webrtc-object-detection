// Fixed client.js - Enhanced WebRTC client with object detection
console.log('Client.js loading...');

// Wait for DOM and config to be ready
document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
});

function initializeApp() {
  console.log('Initializing app...');
  
  // Get configuration from HTML or URL
  const config = window.APP_CONFIG || {};
  const urlParams = new URLSearchParams(window.location.search);
  const mode = config.mode || urlParams.get('mode') || 'receiver';
  const isPhone = mode === 'sender';
  
  console.log('App mode:', mode, 'Is phone:', isPhone);
  
  // Initialize socket connection
  const socket = io();
  
  // WebRTC configuration
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  
  // DOM elements
  const video = document.getElementById('remoteVideo');
  const canvas = document.getElementById('overlayCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const statusDiv = document.getElementById('status');
  const metricsDiv = document.getElementById('metrics');
  
  // State variables
  let localStream = null;
  let isProcessing = false;
  let frameQueue = [];
  let processedFrames = 0;
  let startTime = Date.now();
  const maxQueueSize = 3;
  
  // Utility functions
  function updateStatus(message) {
    console.log('Status:', message);
    if (statusDiv) {
      statusDiv.textContent = `Status: ${message}`;
    }
  }
  
  function updateMetrics() {
    if (metricsDiv && processedFrames > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const fps = processedFrames / elapsed;
      metricsDiv.innerHTML = `
        <div>Mode: ${mode}</div>
        <div>Processed Frames: ${processedFrames}</div>
        <div>FPS: ${fps.toFixed(2)}</div>
        <div>Queue Size: ${frameQueue.length}</div>
        <div>Connection: ${pc.connectionState}</div>
      `;
    }
  }
  
  // Phone (Sender) Mode
  if (isPhone) {
    console.log('Starting phone (sender) mode...');
    updateStatus('Phone mode: Requesting camera access...');
    
    // Hide receiver UI elements
    if (canvas) canvas.style.display = 'none';
    
    // Update UI for phone
    document.body.style.background = '#1a1a1a';
    const container = document.getElementById('container');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: white;">
          <h2>📱 Phone Camera</h2>
          <div id="phone-status" style="margin: 20px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 10px;">
            <div id="status">Starting camera...</div>
          </div>
          <video id="localVideo" autoplay playsinline muted style="width: 100%; max-width: 400px; border-radius: 10px; margin: 20px 0;"></video>
          <div style="font-size: 14px; color: #ccc; margin-top: 20px;">
            <p>✅ Allow camera access when prompted</p>
            <p>📡 Connecting to laptop...</p>
          </div>
        </div>
      `;
    }
    
    const localVideo = document.getElementById('localVideo');
    const phoneStatus = document.getElementById('phone-status');
    
    // Request camera access
    navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 15, max: 30 }
      },
      audio: false
    }).then(stream => {
      console.log('Camera access granted');
      localStream = stream;
      
      if (localVideo) {
        localVideo.srcObject = stream;
      }
      
      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        console.log('Adding track:', track.kind);
        pc.addTrack(track, stream);
      });
      
      updateStatus('Camera ready, creating connection...');
      
      // Create and send offer
      pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        console.log('Sending offer...');
        socket.emit('offer', pc.localDescription);
        updateStatus('Connecting to laptop...');
      }).catch(error => {
        console.error('Offer creation failed:', error);
        updateStatus('Connection failed: ' + error.message);
      });
      
    }).catch(error => {
      console.error('Camera access error:', error);
      updateStatus('Camera access denied: ' + error.message);
      if (phoneStatus) {
        phoneStatus.innerHTML = `
          <div style="color: #ff6b6b;">❌ Camera access denied</div>
          <div style="margin-top: 10px; font-size: 12px;">
            Please refresh and allow camera access
          </div>
        `;
      }
    });
    
  } else {
    // Laptop (Receiver) Mode
    console.log('Starting laptop (receiver) mode...');
    updateStatus('Receiver mode: Waiting for phone connection...');
    
    // Show instructions for connecting phone
    if (video) {
      video.style.display = 'block';
      updateStatus('Waiting for phone to connect...');
      
      // Add connection instructions
      const instructions = document.createElement('div');
      instructions.id = 'connection-instructions';
      instructions.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 30px;
        border-radius: 15px;
        z-index: 1000;
      `;
      instructions.innerHTML = `
        <h2>🔗 Connect Your Phone</h2>
        <p>Go to <strong>/qr</strong> to get the QR code</p>
        <p>Or visit: <a href="/qr" target="_blank" style="color: #4CAF50;">Generate QR Code</a></p>
        <div style="margin-top: 20px; font-size: 14px; color: #ccc;">
          <p>📱 Scan QR with your phone</p>
          <p>🎥 Allow camera access</p>
          <p>👀 See live object detection here</p>
        </div>
      `;
      document.body.appendChild(instructions);
    }
  }
  
  // WebRTC Event Handlers
  pc.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    updateStatus('Video stream received');
    
    if (video && !isPhone) {
      video.srcObject = new MediaStream([event.track]);
      
      video.onloadedmetadata = () => {
        console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
        
        if (canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        
        // Remove connection instructions
        const instructions = document.getElementById('connection-instructions');
        if (instructions) {
          instructions.remove();
        }
        
        // Start processing frames
        startFrameProcessing();
      };
    }
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate');
      socket.emit('ice-candidate', event.candidate);
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
    updateStatus(`Connection: ${pc.connectionState}`);
    
    if (pc.connectionState === 'connected') {
      updateStatus('✅ Connected! Object detection active');
    } else if (pc.connectionState === 'failed') {
      updateStatus('❌ Connection failed - try refreshing');
    }
  };
  
  // Socket Event Handlers
  socket.on('connect', () => {
    console.log('Socket connected');
    updateStatus('Socket connected');
  });
  
  socket.on('offer', async (offer) => {
    console.log('Received offer');
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', answer);
      updateStatus('Answer sent');
    } catch (error) {
      console.error('Error handling offer:', error);
      updateStatus('Error handling connection');
    }
  });
  
  socket.on('answer', async (answer) => {
    console.log('Received answer');
    try {
      await pc.setRemoteDescription(answer);
      updateStatus('Connection established');
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  });
  
  socket.on('ice-candidate', async (candidate) => {
    console.log('Received ICE candidate');
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  });
  
  socket.on('detection-results', (data) => {
    if (!isPhone && ctx) {
      drawOverlays(data.detections, data.frame_id, data.capture_ts);
      processedFrames++;
      updateMetrics();
    }
  });
  
  // Frame Processing (Receiver only)
  function startFrameProcessing() {
    if (isPhone || !video) return;
    
    console.log('Starting frame processing...');
    updateStatus('Processing frames...');
    
    const processFrame = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessing) {
        captureAndProcessFrame();
      }
      setTimeout(processFrame, 1000 / 12); // 12 FPS
    };
    
    processFrame();
  }
  
  function captureAndProcessFrame() {
    if (isProcessing || !video.videoWidth || !video.videoHeight) return;
    
    isProcessing = true;
    
    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      const targetWidth = 320;
      const targetHeight = 240;
      tempCanvas.width = targetWidth;
      tempCanvas.height = targetHeight;
      
      tempCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
      
      const frameId = Date.now().toString();
      const captureTs = Date.now();
      
      tempCanvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => {
          const imageData = reader.result.split(',')[1];
          
          if (frameQueue.length >= maxQueueSize) {
            frameQueue.shift();
          }
          
          const frame = {
            frameId,
            captureTs,
            imageData,
            width: targetWidth,
            height: targetHeight
          };
          
          socket.emit('frame-data', frame);
          isProcessing = false;
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.8);
      
    } catch (error) {
      console.error('Frame capture error:', error);
      isProcessing = false;
    }
  }
  
  function drawOverlays(detections, frameId, captureTs) {
    if (!ctx || !canvas.width || !canvas.height) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    detections.forEach(det => {
      const x = det.xmin * canvas.width;
      const y = det.ymin * canvas.height;
      const width = (det.xmax - det.xmin) * canvas.width;
      const height = (det.ymax - det.ymin) * canvas.height;
      
      // Draw bounding box
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);
      
      // Draw label
      const label = `${det.label} (${(det.score * 100).toFixed(0)}%)`;
      ctx.font = '16px Arial';
      const textMetrics = ctx.measureText(label);
      
      ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.fillRect(x, y - 25, textMetrics.width + 10, 25);
      
      ctx.fillStyle = 'black';
      ctx.fillText(label, x + 5, y - 5);
    });
    
    // Show latency
    if (captureTs) {
      const latency = Date.now() - captureTs;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, 150, 25);
      ctx.fillStyle = 'white';
      ctx.font = '14px Arial';
      ctx.fillText(`Latency: ${latency}ms`, 15, 28);
    }
  }
  
  // Update metrics periodically
  setInterval(updateMetrics, 1000);
  
  // Global functions for UI controls
  window.resetMetrics = function() {
    fetch('/metrics/reset', { method: 'POST' })
      .then(() => {
        processedFrames = 0;
        startTime = Date.now();
        updateMetrics();
      });
  };
  
  window.toggleProcessing = function() {
    isProcessing = !isProcessing;
    const button = document.getElementById('toggleProcessing');
    if (button) {
      button.textContent = isProcessing ? 'Resume' : 'Pause';
    }
  };
  
  window.downloadMetrics = function() {
    fetch('/metrics')
      .then(response => response.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `metrics_${new Date().toISOString().slice(0, 19)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
  };
}