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

// Server setup
let server;
let serverUrl;
let socketIO;

const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  server = https.createServer(options, app);
  serverUrl = `https://${getLocalIP()}:${HTTPS_PORT}`;
  console.log('🔒 Starting HTTPS server for WebRTC compatibility...');
} else {
  server = http.createServer(app);
  serverUrl = `http://${getLocalIP()}:${PORT}`;
  console.log('⚠️ Using HTTP server - camera may not work on mobile');
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
  if (MODE !== 'server') {
    console.log('⏭️ Skipping model initialization (not in server mode)');
    return;
  }
  
  console.log('🔄 Initializing YOLOv5s model...');
  
  if (!fs.existsSync(modelPath)) {
    console.error('❌ Model file not found at:', modelPath);
    return;
  }
  
  try {
    session = await ort.InferenceSession.create(modelPath);
    console.log('✅ YOLOv5s model loaded successfully');
    console.log('📊 Model inputs:', session.inputNames);
    console.log('📊 Model outputs:', session.outputNames);
  } catch (error) {
    console.error('❌ Failed to load model:', error.message);
  }
}

// Process image and return detections
async function processImage(imageData, width, height) {
  if (!session || MODE !== 'server') {
    console.log('❌ No session or not in server mode');
    return [];
  }
  
  try {
    console.log('🔧 Processing image with YOLOv5s...');
    
    if (typeof imageData === 'string') {
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      const buffer = Buffer.from(base64Data, 'base64');
      
      console.log('📊 Input buffer size:', buffer.length);
      
      // Process with Sharp
      const processedData = await sharp(buffer)
        .resize(640, 640)
        .removeAlpha()
        .raw()
        .toBuffer();
      
      console.log('✅ Sharp processing successful, data length:', processedData.length);
      
      if (processedData.length !== 640 * 640 * 3) {
        console.log('❌ Invalid processed data length:', processedData.length);
        return [];
      }
      
      // Convert RGB HWC to CHW format and normalize
      const inputArray = new Float32Array(3 * 640 * 640);
      
      // More efficient conversion
      for (let i = 0; i < 640 * 640; i++) {
        const r = processedData[i * 3] / 255.0;
        const g = processedData[i * 3 + 1] / 255.0;
        const b = processedData[i * 3 + 2] / 255.0;
        
        // CHW format: [channel, height, width]
        inputArray[i] = r;                    // R channel
        inputArray[640 * 640 + i] = g;        // G channel
        inputArray[2 * 640 * 640 + i] = b;    // B channel
      }
      
      // Create tensor with explicit float32 type
      const tensor = new ort.Tensor('float32', inputArray, [1, 3, 640, 640]);
      
      // Run inference
      const feeds = { [session.inputNames[0]]: tensor };
      console.log('📊 Running inference with input:', session.inputNames[0]);
      
      const results = await session.run(feeds);
      console.log('✅ Inference completed successfully!');
      
      // Handle different output names
      let mainOutput;
      if (results['output0']) {
        mainOutput = results['output0'];
      } else if (results['output']) {
        mainOutput = results['output'];
      } else {
        // Use the first output
        const outputKey = Object.keys(results)[0];
        mainOutput = results[outputKey];
        console.log('📊 Using output:', outputKey);
      }
      
      if (!mainOutput) {
        console.log('❌ No output found in results');
        return [];
      }
      
      // Process detections
      const detections = parseDetections(mainOutput.data, mainOutput.dims);
      console.log('📊 Final detections:', detections.length);
      
      return detections;
    }
    
    console.log('❌ Invalid image data format');
    return [];
    
  } catch (error) {
    console.error('❌ Processing error:', error.message);
    console.error('❌ Error stack:', error.stack);
    return [];
  }
}

// Parse YOLO detections
function parseDetections(outputData, outputShape) {
  const detections = [];
  console.log('📊 Parsing detections...');
  console.log('📊 Output shape:', outputShape);
  
  // YOLOv5 output format: [1, 25200, 85]
  const numDetections = 25200;
  const attributesPerDetection = 85;
  const confidenceThreshold = 0.25;
  
  for (let i = 0; i < numDetections; i++) {
    const offset = i * attributesPerDetection;
    
    const centerX = outputData[offset];
    const centerY = outputData[offset + 1];
    const width = outputData[offset + 2];
    const height = outputData[offset + 3];
    const objectness = outputData[offset + 4];
    
    if (objectness > confidenceThreshold) {
      // Find best class
      let bestClassIndex = 0;
      let bestClassScore = 0;
      
      for (let j = 0; j < 80; j++) {
        const classScore = outputData[offset + 5 + j];
        if (classScore > bestClassScore) {
          bestClassScore = classScore;
          bestClassIndex = j;
        }
      }
      
      const finalConfidence = objectness * bestClassScore;
      
      if (finalConfidence > confidenceThreshold) {
        // Convert to normalized coordinates
        const xmin = Math.max(0, (centerX - width/2) / 640);
        const ymin = Math.max(0, (centerY - height/2) / 640);
        const xmax = Math.min(1, (centerX + width/2) / 640);
        const ymax = Math.min(1, (centerY + height/2) / 640);
        
        if (xmax > xmin && ymax > ymin) {
          detections.push({
            label: classNames[bestClassIndex] || 'unknown',
            score: finalConfidence,
            xmin: xmin,
            ymin: ymin,
            xmax: xmax,
            ymax: ymax
          });
        }
      }
    }
  }
  
  return applyNMS(detections, 0.45);
}

// Non-Maximum Suppression
function applyNMS(detections, iouThreshold) {
  if (detections.length === 0) return [];
  
  detections.sort((a, b) => b.score - a.score);
  
  const keep = [];
  const suppressed = new Set();
  
  for (let i = 0; i < detections.length; i++) {
    if (suppressed.has(i)) continue;
    
    keep.push(detections[i]);
    
    for (let j = i + 1; j < detections.length; j++) {
      if (suppressed.has(j)) continue;
      
      const iou = calculateIoU(detections[i], detections[j]);
      if (iou > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  
  return keep;
}

// Calculate Intersection over Union
function calculateIoU(box1, box2) {
  const x1 = Math.max(box1.xmin, box2.xmin);
  const y1 = Math.max(box1.ymin, box2.ymin);
  const x2 = Math.min(box1.xmax, box2.xmax);
  const y2 = Math.min(box1.ymax, box2.ymax);
  
  if (x2 <= x1 || y2 <= y1) return 0;
  
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = (box1.xmax - box1.xmin) * (box1.ymax - box1.ymin);
  const area2 = (box2.xmax - box2.xmin) * (box2.ymax - box2.ymin);
  const union = area1 + area2 - intersection;
  
  return intersection / union;
}

// Metrics tracking
const metrics = {
  frameCount: 0,
  latencies: [],
  startTime: null
};

// Middleware
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
    
    console.log(`📥 Received frame ${frameId}, data size: ${imageData ? imageData.length : 'no data'}`);
    
    try {
      const inferenceStartTs = Date.now();
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
      const endToEndLatency = inferenceTs - captureTs;
      metrics.latencies.push(endToEndLatency);
      
      console.log(`📤 Sending ${detections.length} detections for frame ${frameId}, E2E latency: ${endToEndLatency}ms`);
      
      socket.emit('detection-results', response);
      
    } catch (error) {
      console.error('❌ Frame processing error:', error);
      
      socket.emit('detection-results', {
        frame_id: frameId,
        capture_ts: captureTs,
        recv_ts: recvTs,
        inference_ts: Date.now(),
        detections: []
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.get('/', (req, res) => {
  const mode = req.query.mode || 'receiver';
  
  try {
    let htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    
    const modeScript = `
    <script>
      window.APP_CONFIG = {
        mode: '${mode}',
        isPhone: ${mode === 'sender'},
        serverUrl: window.location.origin,
        debug: true
      };
    </script>`;
    
    htmlContent = htmlContent.replace('</head>', `  ${modeScript}\n</head>`);
    res.send(htmlContent);
  } catch (error) {
    console.error('Error serving HTML:', error);
    res.status(500).send(`Error loading page: ${error.message}`);
  }
});

app.get('/qr', (req, res) => {
  const baseUrl = NGROK_URL || serverUrl;
  const phoneUrl = `${baseUrl}/?mode=sender`;
  
  QRCode.toDataURL(phoneUrl, { width: 300, margin: 2 }, (err, qrUrl) => {
    if (err) {
      res.status(500).send('Error generating QR code: ' + err.message);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WebRTC Object Detection - QR Code</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; padding: 30px; }
            .qr-code { margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 WebRTC Object Detection</h1>
            <h2>Connect Your Phone</h2>
            
            <h3>Scan QR Code</h3>
            <div class="qr-code">
              <img src="${qrUrl}" alt="QR Code"/>
            </div>
            
            <p><strong>Phone URL:</strong> <a href="${phoneUrl}">${phoneUrl}</a></p>
            <p><strong>Laptop URL:</strong> <a href="${serverUrl}">${serverUrl}</a></p>
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
    timestamp: new Date().toISOString()
  });
});

app.get('/metrics', (req, res) => {
  const latencies = metrics.latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const fps = metrics.frameCount / ((Date.now() - metrics.startTime) / 1000) || 0;
  
  res.json({
    median_latency_ms: median,
    p95_latency_ms: p95,
    processed_fps: fps,
    total_frames: metrics.frameCount,
    mode: MODE
  });
});

app.post('/metrics/reset', (req, res) => {
  metrics.frameCount = 0;
  metrics.latencies = [];
  metrics.startTime = Date.now();
  res.json({ status: 'reset' });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: MODE,
    modelLoaded: session !== null
  });
});

// Start server
async function startServer() {
  console.log(`Starting server in ${MODE} mode...`);
  
  await initializeModel();
  
  metrics.startTime = Date.now();
  
  const port = fs.existsSync(keyPath) && fs.existsSync(certPath) ? HTTPS_PORT : PORT;
  
  server.listen(port, () => {
    console.log(`Server running on ${serverUrl}`);
    console.log(`Mode: ${MODE}`);
    console.log(`📱 Phone URL: ${serverUrl}?mode=sender`);
    console.log(`💻 Laptop URL: ${serverUrl}`);
    if (NGROK_URL) {
      console.log(`Public URL: ${NGROK_URL}`);
    }
  });
}

startServer().catch(console.error);