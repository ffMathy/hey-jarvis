#!/bin/bash
set -e

# Home Assistant Addon Test Image Build Script
# Builds the test image with nginx for E2E testing

# Check required dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

echo "🧪 Building Hey Jarvis Home Assistant Addon Test Image..."

# Build Docker test image
echo "🐳 Building Docker test image with nginx..."
docker build \
    -f home-assistant-addon/Dockerfile \
    --build-arg NGINX_ALLOWED_IP=all \
    --target home-assistant-addon-end-to-end-test \
    -t home-assistant-addon-test \
    .

echo "✅ Test image build complete!"
echo "📦 Test image: home-assistant-addon-test"
