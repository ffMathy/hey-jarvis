#!/bin/bash
set -e

# Home Assistant Addon Build Script
# Builds the Docker image for the addon

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
echo "   Base Image: ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest (locally built)"

# Verify the base image exists locally
if ! docker image inspect "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest" >/dev/null 2>&1; then
    echo "❌ Base image ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest not found locally"
    echo "   Run 'npx nx docker:build jarvis-mcp' first to build the base image"
    exit 1
fi

# Build the Docker image
echo "🐳 Building Docker image..."
docker build \
    -f home-assistant-addon/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest" \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG" \
    --build-arg "BUILD_FROM=ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG" \
    home-assistant-addon

echo "✅ Build complete!"
echo "📦 Images created:"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG"