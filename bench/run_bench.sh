#!/bin/bash

# Benchmark Script for WebRTC Object Detection
set -e

# Default values
DURATION=30
MODE="server"
OUTPUT_FILE="metrics.json"
SERVER_URL="http://localhost:3000"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --url)
      SERVER_URL="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --duration <seconds>    Benchmark duration (default: 30)"
      echo "  --mode <server|wasm>    Inference mode (default: server)"
      echo "  --output <file>         Output file (default: metrics.json)"
      echo "  --url <url>             Server URL (default: http://localhost:3000)"
      echo "  -h, --help              Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🔥 Starting WebRTC Object Detection Benchmark"
echo "Duration: ${DURATION}s"
echo "Mode: $MODE"
echo "Output: $OUTPUT_FILE"

# Check if server is running
if ! curl -s "$SERVER_URL/health" > /dev/null; then
    echo "❌ Server is not running at $SERVER_URL"
    echo "   Please start the server first with: ./start.sh"
    exit 1
fi

# Reset metrics
echo "📊 Resetting metrics..."
curl -s -X POST "$SERVER_URL/metrics/reset" > /dev/null

# Start monitoring
echo "⏱️  Running benchmark for ${DURATION} seconds..."

# Function to get system metrics
get_system_metrics() {
    local cpu_usage=""
    local memory_usage=""
    
    if command -v top &> /dev/null; then
        # Get CPU and memory usage
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            cpu_usage=$(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')
            memory_usage=$(top -l 1 -n 0 | grep "PhysMem" | awk '{print $2}' | sed 's/M//')
        else
            # Linux
            cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
            memory_usage=$(free -m | awk 'NR==2{printf "%.1f", $3*100/$2}')
        fi
    fi
    
    echo "{\"cpu_usage_percent\": \"$cpu_usage\", \"memory_usage_mb\": \"$memory_usage\"}"
}

# Function to get network stats
get_network_stats() {
    local rx_bytes=""
    local tx_bytes=""
    
    if command -v ifstat &> /dev/null; then
        # Use ifstat if available
        local stats=$(ifstat -i eth0 -q 1 1 2>/dev/null | tail -n 1)
        rx_bytes=$(echo $stats | awk '{print $1}')
        tx_bytes=$(echo $stats | awk '{print $2}')
    elif [[ -f /proc/net/dev ]]; then
        # Linux fallback
        local interface=$(ip route | grep default | awk '{print $5}' | head -n1)
        if [ -n "$interface" ]; then
            local line=$(grep "$interface" /proc/net/dev)
            rx_bytes=$(echo $line | awk '{print $2}')
            tx_bytes=$(echo $line | awk '{print $10}')
        fi
    fi
    
    echo "{\"rx_kbps\": \"$rx_bytes\", \"tx_kbps\": \"$tx_bytes\"}"
}

# Store initial system state
INITIAL_SYSTEM=$(get_system_metrics)
INITIAL_NETWORK=$(get_network_stats)

# Wait for benchmark duration
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

# Monitor progress
while [ $(date +%s) -lt $END_TIME ]; do
    REMAINING=$((END_TIME - $(date +%s)))
    echo -ne "\r⏳ Benchmark running... ${REMAINING}s remaining"
    sleep 1
done

echo -e "\n✅ Benchmark completed!"

# Get final metrics from server
echo "📈 Collecting metrics..."
METRICS_RESPONSE=$(curl -s "$SERVER_URL/metrics")

# Get final system state
FINAL_SYSTEM=$(get_system_metrics)
FINAL_NETWORK=$(get_network_stats)

# Create comprehensive metrics report
cat > "$OUTPUT_FILE" << EOF
{
  "benchmark_info": {
    "duration_seconds": $DURATION,
    "mode": "$MODE",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "server_url": "$SERVER_URL"
  },
  "performance_metrics": $METRICS_RESPONSE,
  "system_metrics": {
    "initial": $INITIAL_SYSTEM,
    "final": $FINAL_SYSTEM
  },
  "network_metrics": {
    "initial": $INITIAL_NETWORK,
    "final": $FINAL_NETWORK
  }
}
EOF

# Pretty print results
echo "📊 Benchmark Results:"
echo "===================="

if command -v jq &> /dev/null; then
    # Use jq for pretty printing if available
    jq -r '
    "📈 Performance Metrics:",
    "  Median Latency: \(.performance_metrics.median_latency_ms)ms",
    "  P95 Latency: \(.performance_metrics.p95_latency_ms)ms", 
    "  Processed FPS: \(.performance_metrics.processed_fps | tonumber | . * 100 | round / 100)",
    "  Total Frames: \(.performance_metrics.total_frames)",
    "  Mode: \(.performance_metrics.mode)",
    "",
    "💻 System Resource Usage:",
    "  CPU Usage: \(.system_metrics.final.cpu_usage_percent)%",
    "  Memory Usage: \(.system_metrics.final.memory_usage_mb)MB",
    "",
    "🌐 Network (Estimated):",
    "  Uplink: \(.performance_metrics.uplink_kbps)kbps",
    "  Downlink: \(.performance_metrics.downlink_kbps)kbps"
    ' "$OUTPUT_FILE"
else
    # Fallback without jq
    echo "  Median Latency: $(echo $METRICS_RESPONSE | grep -o '"median_latency_ms":[0-9]*' | cut -d: -f2)ms"
    echo "  P95 Latency: $(echo $METRICS_RESPONSE | grep -o '"p95_latency_ms":[0-9]*' | cut -d: -f2)ms"
    echo "  Processed FPS: $(echo $METRICS_RESPONSE | grep -o '"processed_fps":[0-9.]*' | cut -d: -f2)"
    echo "  Total Frames: $(echo $METRICS_RESPONSE | grep -o '"total_frames":[0-9]*' | cut -d: -f2)"
    echo "  Mode: $MODE"
fi

echo ""
echo "📄 Full metrics saved to: $OUTPUT_FILE"
echo "🎯 Benchmark completed successfully!"

# Optional: Open metrics file if on desktop environment
if command -v xdg-open &> /dev/null; then
    read -p "📖 Open metrics file? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        xdg-open "$OUTPUT_FILE"
    fi
elif command -v open &> /dev/null; then
    read -p "📖 Open metrics file? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "$OUTPUT_FILE"
    fi
fi