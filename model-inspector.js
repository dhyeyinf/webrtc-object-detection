// model-inspector.js
const ort = require('onnxruntime-node');
const path = require('path');

async function inspectModel() {
    const modelPath = path.join(__dirname, 'models', 'yolov5s.onnx');
    
    try {
        console.log('Loading model from:', modelPath);
        const session = await ort.InferenceSession.create(modelPath);
        
        console.log('\n=== MODEL INFORMATION ===');
        console.log('✅ Model loaded successfully');
        console.log('📋 Input names:', session.inputNames);
        console.log('📋 Output names:', session.outputNames);
        
        // Test with a dummy tensor to see what data type is expected
        console.log('\n=== TESTING DATA TYPES ===');
        const testData = new Float32Array(1 * 3 * 640 * 640).fill(0.5);
        
        try {
            const tensor = new ort.Tensor('float32', testData, [1, 3, 640, 640]);
            const feeds = {};
            feeds[session.inputNames[0]] = tensor;
            
            const results = await session.run(feeds);
            console.log('✅ Model accepts float32 tensors');
            console.log('📋 Output shapes:');
            Object.keys(results).forEach(key => {
                console.log(`  ${key}: [${results[key].dims.join(', ')}]`);
                console.log(`  ${key} data length: ${results[key].data.length}`);
            });
            
        } catch (error) {
            console.log('❌ float32 failed:', error.message);
            
            if (error.message.includes('float16')) {
                console.log('🔄 Model expects float16 - this needs special handling');
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to load model:', error.message);
        console.log('\n💡 Suggestions:');
        console.log('1. Make sure models/yolov5s.onnx exists');
        console.log('2. Try downloading a different YOLOv5s model');
        console.log('3. Check if the model file is corrupted');
    }
}

inspectModel().catch(console.error);