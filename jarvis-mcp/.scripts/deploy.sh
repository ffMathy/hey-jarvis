#!/bin/bash
set -e

# Jarvis MCP Deployment Script
# Builds and pushes multi-architecture Docker images to GitHub Container Registry

echo "🚀 Starting Jarvis MCP deployment..."

# Check required environment variables
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ GITHUB_TOKEN environment variable is required"
    exit 1
fi

if [ -z "$GITHUB_ACTOR" ]; then
    echo "❌ GITHUB_ACTOR environment variable is required"
    exit 1
fi

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "📋 Deployment configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Image Tag: $IMAGE_TAG"
echo "   GitHub Actor: $GITHUB_ACTOR"
echo "   Architectures: amd64, arm64, arm/v7"

# Login to GitHub Container Registry
echo "🔐 Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# Create builder instance if it doesn't exist
if ! docker buildx inspect multiarch-builder &> /dev/null 2>&1; then
    echo "🔧 Creating buildx builder instance..."
    docker buildx create --name multiarch-builder --use
else
    docker buildx use multiarch-builder
fi

# Build and push multi-architecture images
echo "🐳 Building and pushing multi-architecture Docker images..."
docker buildx build \
    --platform linux/amd64,linux/arm64,linux/arm/v7 \
    -f jarvis-mcp/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest" \
    -t "ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --push \
    .

echo "✅ Deployment complete!"
echo "📦 Multi-arch images pushed to registry:"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"