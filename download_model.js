const fs = require('fs');
const https = require('https');
const path = require('path');

const modelDir = path.join(__dirname, 'models');
const modelPath = path.join(modelDir, 'yolov5n.onnx');

// Create models directory if it doesn't exist
if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
}

// Download YOLOv5n ONNX model
const modelUrl = 'https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx';

console.log('📥 Downloading YOLOv5n ONNX model...');
console.log('📍 From:', modelUrl);
console.log('💾 To:', modelPath);

const file = fs.createWriteStream(modelPath);

https.get(modelUrl, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
            const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
            let downloadedSize = 0;
            
            redirectResponse.pipe(file);
            
            redirectResponse.on('data', (chunk) => {
                downloadedSize += chunk.length;
                const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
                process.stdout.write(`\r⏳ Progress: ${progress}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
            });
            
            file.on('finish', () => {
                file.close();
                console.log('\n✅ Model downloaded successfully!');
                console.log(`📊 File size: ${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(1)}MB`);
            });
        }).on('error', (err) => {
            fs.unlink(modelPath, () => {}); // Delete incomplete file
            console.error('\n❌ Download error:', err.message);
            process.exit(1);
        });
    } else {
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        response.pipe(file);
        
        response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize) {
                const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
                process.stdout.write(`\r⏳ Progress: ${progress}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
            }
        });
        
        file.on('finish', () => {
            file.close();
            console.log('\n✅ Model downloaded successfully!');
            console.log(`📊 File size: ${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(1)}MB`);
        });
    }
}).on('error', (err) => {
    fs.unlink(modelPath, () => {}); // Delete incomplete file
    console.error('\n❌ Download error:', err.message);
    console.log('\n🔄 Trying alternative download method...');
    
    // Try alternative URL
    const altUrl = 'https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/yolov5/model/yolov5n.onnx';
    console.log('📍 Alternative URL:', altUrl);
    
    https.get(altUrl, (altResponse) => {
        altResponse.pipe(fs.createWriteStream(modelPath));
        altResponse.on('end', () => {
            console.log('✅ Model downloaded from alternative source!');
        });
    }).on('error', (altErr) => {
        console.error('❌ Alternative download failed:', altErr.message);
        console.log('\n📋 Manual download instructions:');
        console.log('1. Visit: https://github.com/ultralytics/yolov5/releases/tag/v7.0');
        console.log('2. Download yolov5n.onnx');
        console.log('3. Place it in: ./models/yolov5n.onnx');
        process.exit(1);
    });
});

file.on('error', (err) => {
    fs.unlink(modelPath, () => {}); // Delete incomplete file
    console.error('❌ File write error:', err.message);
    process.exit(1);
});