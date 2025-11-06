#!/bin/bash
set -e

# Home Assistant Addon Deployment Script
# Builds and pushes multi-architecture Docker images to GitHub Container Registry

PROJECT_DIR="$(dirname "$0")/.."

echo "🚀 Starting Hey Jarvis Home Assistant Addon deployment..."

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

# Determine version from project's package.json
PROJECT_VERSION=$(jq -r '.version' "$PROJECT_DIR/package.json")
IMAGE_TAG="${PROJECT_VERSION}"
echo "📦 Detected project version: $PROJECT_VERSION"

echo "📋 Deployment configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Image Tag: $IMAGE_TAG"
echo "   GitHub Actor: $GITHUB_ACTOR"
echo "   Architectures: amd64, arm64, arm/v7"

# Get current version from config.json for validation
CONFIG_VERSION=$(jq -r '.version' "$PROJECT_DIR/config.json")
echo "📦 Config.json version: $CONFIG_VERSION"

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
    --platform linux/amd64,linux/arm64 \
    -f home-assistant-addon/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest" \
    -t "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG" \
    --build-arg "BUILD_FROM=ghcr.io/$IMAGE_OWNER/mcp:$IMAGE_TAG" \
    --push \
    home-assistant-addon

echo "✅ Deployment complete!"
echo "📦 Multi-arch images pushed to registry:"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:$IMAGE_TAG"
