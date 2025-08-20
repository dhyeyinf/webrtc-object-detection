# Use Node.js LTS version
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create models directory
RUN mkdir -p models

# Download model if not present
RUN if [ ! -f models/yolov5n.onnx ]; then \
      node download_model.js || echo "Model download will be attempted at runtime"; \
    fi

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Default environment variables
ENV MODE=server
ENV PORT=3000
ENV NODE_ENV=production

# Create non-root user
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Start application
CMD ["node", "server.js"]