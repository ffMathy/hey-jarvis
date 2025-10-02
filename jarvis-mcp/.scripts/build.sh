#!/bin/bash
set -e

# Jarvis MCP Docker Build Script
# Builds multi-architecture Docker images for the Jarvis MCP server

# Check required dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "🏗️ Building Jarvis MCP Docker image..."
echo "📋 Build configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Image Tag: $IMAGE_TAG"

# Build Docker image locally
echo "🐳 Building Docker image..."
docker build \
    -f jarvis-mcp/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest" \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG" \
    .

echo "✅ Build complete!"
echo "📦 Local images:"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"