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
echo "   Architectures: amd64, arm64, arm/v7"

# Create builder instance if it doesn't exist
if ! docker buildx inspect multiarch-builder &> /dev/null 2>&1; then
    echo "🔧 Creating buildx builder instance..."
    docker buildx create --name multiarch-builder --use
else
    docker buildx use multiarch-builder
fi

# Build multi-architecture Docker image and push to registry
echo "🐳 Building and pushing multi-architecture Docker image..."
docker buildx build \
    --platform linux/amd64,linux/arm64,linux/arm/v7 \
    -f jarvis-mcp/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest" \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --push \
    .

echo "✅ Build and push complete!"
echo "📦 Multi-arch images pushed to registry:"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"