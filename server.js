const express = require('express');
const app = express();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const io = require('socket.io');
const QRCode = require('qrcode');
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const jimp = require('jimp'); 

// Configuration
const MODE = process.env.MODE || 'server';
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const NGROK_URL = process.env.NGROK_URL;

// Get local IP address
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Try to create HTTPS server if certificates exist
let server;
let serverUrl;
let socketIO;

const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  // HTTPS server
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  server = https.createServer(options, app);
  serverUrl = `https://${getLocalIP()}:${HTTPS_PORT}`;
  console.log('🔒 Starting HTTPS server for WebRTC compatibility...');
} else {
  // Fallback to HTTP
  server = http.createServer(app);
  serverUrl = `http://${getLocalIP()}:${PORT}`;
  console.log('⚠️  Using HTTP server - camera may not work on mobile');
}

// Initialize Socket.IO
socketIO = io(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Model and inference setup
let session = null;
const modelPath = path.join(__dirname, 'models', 'yolov5s.onnx');

// COCO class names for YOLOv5
const classNames = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'
];

// Initialize model for server mode
async function initializeModel() {
  if (MODE === 'server' && fs.existsSync(modelPath)) {
    try {
      session = await ort.InferenceSession.create(modelPath);
      console.log('Model loaded for server-side inference');
    } catch (error) {
      console.error('Failed to load model:', error);
    }
  }
}

// Process image and return detections
async function processImage(imageData, width, height) {
  if (!session || MODE !== 'server') return [];
  
  try {
    console.log('🔧 Processing image with YOLOv5s...');
    
    if (typeof imageData === 'string') {
      // Handle base64 string
      const base64Data = imageData.split(',')[1] || imageData;
      const buffer = Buffer.from(base64Data, 'base64');
      
      console.log('📊 Input buffer size:', buffer.length);
      
      // Process with Sharp
      const { data, info } = await sharp(buffer)
        .resize(640, 640)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      console.log('📊 Sharp processed:', info);
      console.log('📊 Raw data length:', data.length);
      
      // Check for actual pixel data
      const samplePixels = Array.from(data.slice(0, 20));
      console.log('📊 Sample pixel values:', samplePixels);
      
      const nonZeroCount = data.filter(val => val > 0).length;
      console.log('📊 Non-zero pixels:', nonZeroCount);
      
      if (nonZeroCount === 0) {
        console.log('⚠️ All pixels are zero, trying Jimp fallback...');
        
        // Fallback to Jimp
        const image = await jimp.read(buffer);
        image.resize(640, 640);
        const jimpData = image.bitmap.data;
        
        // Convert RGBA to RGB Float32Array
        const processedData = new Float32Array(640 * 640 * 3);
        for (let i = 0, j = 0; i < jimpData.length; i += 4) {
          processedData[j++] = jimpData[i] / 255.0;     // R
          processedData[j++] = jimpData[i + 1] / 255.0; // G
          processedData[j++] = jimpData[i + 2] / 255.0; // B
        }
        
        console.log('📊 Jimp processed sample:', Array.from(processedData.slice(0, 10)));
        
        // Create tensor with float32 (YOLOv5s should support this)
        const input = new ort.Tensor('float32', processedData, [1, 3, 640, 640]);
        const results = await session.run({ images: input });
        console.log('✅ Inference successful with Jimp data');
        
        return parseDetections(results.output0.data, width, height);
      }
      
      // Normal Sharp processing
      const processedData = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        processedData[i] = data[i] / 255.0;
      }
      
      console.log('📊 Normalized sample:', Array.from(processedData.slice(0, 10)));
      
      // Create tensor with float32
      const input = new ort.Tensor('float32', processedData, [1, 3, 640, 640]);
      const results = await session.run({ images: input });
      console.log('✅ Inference successful with Sharp data');
      
      return parseDetections(results.output0.data, width, height);
    }
    
    return [];
  } catch (error) {
    console.error('❌ Processing error:', error);
    return [];
  }
}

// Also update your parseDetections function for YOLOv5s (it might have different output format):
function parseDetections(output, originalWidth, originalHeight) {
  const detections = [];
  console.log('📊 Raw output length:', output.length);
  
  // YOLOv5s output format: [batch, detections, 85]
  // where 85 = [x, y, w, h, confidence, ...80 class scores]
  const numDetections = output.length / 85;
  console.log('📊 Number of potential detections:', numDetections);
  
  for (let i = 0; i < numDetections; i++) {
    const offset = i * 85;
    const confidence = output[offset + 4];
    
    if (confidence > 0.25) {  // Lower threshold for testing
      const x = output[offset];
      const y = output[offset + 1];
      const w = output[offset + 2];
      const h = output[offset + 3];
      
      // Find best class
      let bestClass = 0;
      let bestScore = 0;
      for (let j = 0; j < 80; j++) {
        const score = output[offset + 5 + j];
        if (score > bestScore) {
          bestScore = score;
          bestClass = j;
        }
      }
      
      const finalScore = confidence * bestScore;
      console.log(`📊 Detection ${i}: class=${bestClass}, confidence=${confidence.toFixed(3)}, finalScore=${finalScore.toFixed(3)}`);
      
      if (finalScore > 0.25) {  // Lower threshold for testing
        detections.push({
          label: classNames[bestClass] || 'unknown',
          score: finalScore,
          xmin: Math.max(0, (x - w/2) / 640),
          ymin: Math.max(0, (y - h/2) / 640),
          xmax: Math.min(1, (x + w/2) / 640),
          ymax: Math.min(1, (y + h/2) / 640)
        });
      }
    }
  }
  
  console.log(`✅ Found ${detections.length} valid detections`);
  return detections;
}

// Metrics tracking
const metrics = {
  frameCount: 0,
  latencies: [],
  startTime: null,
  bandwidthSamples: []
};

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// WebRTC signaling
socketIO.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('offer', (data) => {
    socket.broadcast.emit('offer', data);
  });
  
  socket.on('answer', (data) => {
    socket.broadcast.emit('answer', data);
  });
  
  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data);
  });
  
  // Handle frame data for inference
  socket.on('frame-data', async (data) => {
    const { frameId, captureTs, imageData, width, height } = data;
    const recvTs = Date.now();
    
    try {
      const detections = await processImage(imageData, width, height);
      const inferenceTs = Date.now();
      
      const response = {
        frame_id: frameId,
        capture_ts: captureTs,
        recv_ts: recvTs,
        inference_ts: inferenceTs,
        detections: detections
      };
      
      // Track metrics
      metrics.frameCount++;
      metrics.latencies.push(inferenceTs - captureTs);
      
      socket.emit('detection-results', response);
    } catch (error) {
      console.error('Frame processing error:', error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('/', (req, res) => {
  const mode = req.query.mode || 'receiver';
  console.log(`Serving page for mode: ${mode}`);
  
  try {
    let htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    
    // Add mode configuration to HTML
    const modeScript = `
    <script>
      // Global configuration
      window.APP_CONFIG = {
        mode: '${mode}',
        isPhone: ${mode === 'sender'},
        serverUrl: window.location.origin,
        debug: true
      };
      console.log('App Config:', window.APP_CONFIG);
    </script>`;
    
    // Insert script before closing head tag
    htmlContent = htmlContent.replace('</head>', `  ${modeScript}\n</head>`);
    
    res.send(htmlContent);
  } catch (error) {
    console.error('Error serving HTML:', error);
    res.status(500).send(`
      <html>
        <body>
          <h1>Error Loading Page</h1>
          <p>Could not load index.html: ${error.message}</p>
          <p>Make sure public/index.html exists</p>
        </body>
      </html>
    `);
  }
});

// Generate QR code
app.get('/qr', (req, res) => {
  const baseUrl = NGROK_URL || serverUrl;
  const phoneUrl = `${baseUrl}/?mode=sender`;
  const laptopUrl = fs.existsSync(keyPath) && fs.existsSync(certPath) 
    ? `https://localhost:${HTTPS_PORT}` 
    : `http://localhost:${PORT}`;
  
  console.log(`QR Code URLs - Phone: ${phoneUrl}, Laptop: ${laptopUrl}`);
  
  QRCode.toDataURL(phoneUrl, { width: 300, margin: 2 }, (err, qrUrl) => {
    if (err) {
      console.error('QR Code generation error:', err);
      res.status(500).send('Error generating QR code: ' + err.message);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WebRTC Object Detection - QR Code</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 20px; 
              background: #f0f0f0; 
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white; 
              padding: 30px; 
              border-radius: 10px; 
              box-shadow: 0 0 10px rgba(0,0,0,0.1); 
            }
            .qr-code { 
              margin: 20px 0; 
              border: 3px solid #ddd; 
              display: inline-block; 
              padding: 10px; 
              background: white; 
            }
            .url-box { 
              background: #f8f8f8; 
              padding: 15px; 
              border-radius: 5px; 
              margin: 15px 0; 
              border: 1px solid #ddd;
              word-break: break-all;
              font-family: monospace;
            }
            .instructions { 
              text-align: left; 
              background: #e8f4f8; 
              padding: 20px; 
              border-radius: 8px; 
              margin: 20px 0; 
            }
            .status { 
              background: #d4edda; 
              color: #155724; 
              padding: 10px; 
              border-radius: 5px; 
              margin: 10px 0; 
            }
            .warning { 
              background: #fff3cd; 
              color: #856404; 
              padding: 10px; 
              border-radius: 5px; 
              margin: 10px 0; 
            }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 WebRTC Object Detection</h1>
            <h2>Connect Your Phone</h2>
            
            <div class="status">
              <strong>✅ Server is running on ${getLocalIP()}:${fs.existsSync(keyPath) && fs.existsSync(certPath) ? HTTPS_PORT : PORT}</strong>
            </div>
            
            ${fs.existsSync(keyPath) && fs.existsSync(certPath) ? 
              '<div class="warning"><strong>🔒 HTTPS Enabled:</strong> You may see a security warning - click "Advanced" then "Proceed" to continue</div>' : 
              '<div class="warning"><strong>⚠️ HTTP Mode:</strong> Camera access may be limited on mobile devices</div>'
            }
            
            <h3>Method 1: Scan QR Code</h3>
            <div class="qr-code">
              <img src="${qrUrl}" alt="QR Code for phone connection"/>
            </div>
            
            <h3>Method 2: Type URL manually</h3>
            <div class="url-box">
              <strong>Phone URL:</strong><br>
              <a href="${phoneUrl}" target="_blank">${phoneUrl}</a>
            </div>
            
            <div class="instructions">
              <h4>📋 Step-by-step Instructions:</h4>
              <ol>
                <li><strong>On your phone:</strong> Scan the QR code above OR type the URL manually</li>
                <li><strong>Accept security warning</strong> (if using HTTPS)</li>
                <li><strong>Allow camera access</strong> when prompted</li>
                <li><strong>On your laptop:</strong> Go to <a href="${laptopUrl}" target="_blank">${laptopUrl}</a></li>
                <li>You should see your phone's camera feed with object detection!</li>
              </ol>
            </div>
            
            <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-radius: 5px;">
              <h4>🔧 Troubleshooting:</h4>
              <ul style="text-align: left;">
                <li>Make sure both devices are on the same WiFi network</li>
                <li>If connection fails, try refreshing both pages</li>
                <li>Check browser console for error messages</li>
                <li>Ensure camera permissions are granted on phone</li>
                <li>If using HTTPS, accept the security certificate warning</li>
              </ul>
            </div>
            
            <div style="margin-top: 20px; font-size: 12px; color: #666;">
              <p><strong>Network Info:</strong></p>
              <p>Laptop IP: ${getLocalIP()} | Port: ${fs.existsSync(keyPath) && fs.existsSync(certPath) ? HTTPS_PORT : PORT}</p>
              <p>Laptop URL: <a href="${laptopUrl}">${laptopUrl}</a></p>
              <p>Protocol: ${fs.existsSync(keyPath) && fs.existsSync(certPath) ? 'HTTPS' : 'HTTP'}</p>
            </div>
          </div>
        </body>
        </html>
      `);
    }
  });
});

app.get('/test', (req, res) => {
  res.json({
    status: 'Server is working!',
    mode: MODE,
    modelLoaded: session !== null,
    localIP: getLocalIP(),
    port: fs.existsSync(keyPath) && fs.existsSync(certPath) ? HTTPS_PORT : PORT,
    protocol: fs.existsSync(keyPath) && fs.existsSync(certPath) ? 'HTTPS' : 'HTTP',
    timestamp: new Date().toISOString()
  });
});

// API endpoint for metrics
app.get('/metrics', (req, res) => {
  const latencies = metrics.latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const fps = metrics.frameCount / ((Date.now() - metrics.startTime) / 1000) || 0;
  
  const result = {
    median_latency_ms: median,
    p95_latency_ms: p95,
    processed_fps: fps,
    total_frames: metrics.frameCount,
    mode: MODE,
    uplink_kbps: 0, // Would need WebRTC stats
    downlink_kbps: 0 // Would need WebRTC stats
  };
  
  res.json(result);
});

// Endpoint to reset metrics
app.post('/metrics/reset', (req, res) => {
  metrics.frameCount = 0;
  metrics.latencies = [];
  metrics.startTime = Date.now();
  metrics.bandwidthSamples = [];
  res.json({ status: 'reset' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: MODE,
    modelLoaded: session !== null,
    protocol: fs.existsSync(keyPath) && fs.existsSync(certPath) ? 'HTTPS' : 'HTTP'
  });
});

// Initialize and start server
async function startServer() {
  console.log(`Starting server in ${MODE} mode...`);
  
  if (MODE === 'server') {
    await initializeModel();
  }
  
  metrics.startTime = Date.now();
  
  const port = fs.existsSync(keyPath) && fs.existsSync(certPath) ? HTTPS_PORT : PORT;
  
  server.listen(port, () => {
    console.log(`Server running on ${serverUrl}`);
    console.log(`Mode: ${MODE}`);
    console.log(`📱 Phone URL: ${serverUrl}?mode=sender`);
    console.log(`💻 Laptop URL: ${fs.existsSync(keyPath) && fs.existsSync(certPath) ? `https://localhost:${HTTPS_PORT}` : `http://localhost:${PORT}`}`);
    if (NGROK_URL) {
      console.log(`Public URL: ${NGROK_URL}`);
    }
  });
}

startServer().catch(console.error);