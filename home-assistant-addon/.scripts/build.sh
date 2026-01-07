#!/bin/bash
set -e

# Home Assistant Addon Build Script
# Builds multi-architecture Docker images for the addon

# Check required dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "🏗️ Building Hey Jarvis Home Assistant Addon..."
echo "📋 Build configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Image Tag: $IMAGE_TAG"

# Build Docker image locally
echo "🐳 Building Docker image..."
docker build \
    -f home-assistant-addon/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest" \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG" \
    --build-arg "BUILD_FROM=ghcr.io/$IMAGE_OWNER/mcp:$IMAGE_TAG" \
    .

echo "✅ Build complete!"
echo "📦 Local images:"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG"