// download_model.js - Script to download YOLOv5n quantized model
const fs = require('fs');
const https = require('https');
const path = require('path');

const MODEL_URL = 'https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx';
const MODEL_PATH = path.join(__dirname, 'models', 'yolov5n.onnx');

function downloadModel() {
  if (fs.existsSync(MODEL_PATH)) {
    console.log('Model already exists');
    return;
  }

  console.log('Downloading YOLOv5n model...');
  const file = fs.createWriteStream(MODEL_PATH);
  
  https.get(MODEL_URL, (response) => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('Model downloaded successfully');
    });
  }).on('error', (err) => {
    fs.unlink(MODEL_PATH, () => {}); // Delete the file on error
    console.error('Error downloading model:', err.message);
  });
}

downloadModel();