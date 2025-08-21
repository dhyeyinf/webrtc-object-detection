const express = require('express');
const app = express();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const io = require('socket.io');
const QRCode = require('qrcode');
const tf = require('@tensorflow/tfjs-node');
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
let model = null;

// COCO class names
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
  
  console.log('🔄 Loading COCO-SSD model...');
  
  try {
    // Load the COCO-SSD model
    model = await tf.node.loadSavedModel('https://tfhub.dev/tensorflow/ssd_mobilenet_v2/2');
    console.log('✅ COCO-SSD model loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load model:', error.message);
    console.log('🔄 Trying alternative model...');
    
    try {
      // Try a different model
      model = await tf.node.loadSavedModel('https://tfhub.dev/tensorflow/ssd_mobilenet_v1_fpn/2');
      console.log('✅ Alternative model loaded successfully');
    } catch (fallbackError) {
      console.error('❌ Fallback model also failed:', fallbackError.message);
    }
  }
}

// Process image and return detections
async function processImage(imageData, width, height) {
  if (!model || MODE !== 'server') {
    console.log('❌ No model or not in server mode');
    return [];
  }
  
  try {
    console.log('🔧 Processing image with TensorFlow.js...');
    
    if (typeof imageData === 'string') {
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      const buffer = Buffer.from(base64Data, 'base64');
      
      console.log('📊 Input buffer size:', buffer.length);
      
      // Process with Sharp
      const processedBuffer = await sharp(buffer)
        .resize(300, 300)
        .removeAlpha()
        .toBuffer();
      
      // Convert to tensor
      const tensor = tf.node.decodeImage(processedBuffer);
      const batched = tensor.expandDims(0);
      
      // Run inference
      console.log('📊 Running inference...');
      const predictions = model.predict(batched);
      
      // Process results
      const detections = [];
      const scores = predictions[1].dataSync();
      const boxes = predictions[0].dataSync();
      const classes = predictions[2].dataSync();
      
      const confidenceThreshold = 0.5;
      
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] > confidenceThreshold) {
          const classId = classes[i];
          const score = scores[i];
          const [ymin, xmin, ymax, xmax] = boxes.slice(i * 4, (i + 1) * 4);
          
          detections.push({
            label: classNames[classId] || 'unknown',
            score: score,
            xmin: xmin,
            ymin: ymin,
            xmax: xmax,
            ymax: ymax
          });
        }
      }
      
      // Clean up tensors
      tensor.dispose();
      batched.dispose();
      tf.dispose(predictions);
      
      console.log('✅ Inference completed successfully!');
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

// Routes (keep the same as before)
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

// Keep all other routes the same as in your original server.js

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