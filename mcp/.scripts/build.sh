#!/bin/bash
set -e

# MCP Docker Build Script
# Builds multi-architecture Docker images for the MCP server

# Check required dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "🏗️ Building MCP Docker image..."
echo "📋 Build configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Image Tag: $IMAGE_TAG"

# Build Docker image locally
echo "🐳 Building Docker image..."
if ! docker build \
    -f mcp/Dockerfile \
    -t "ghcr.io/$IMAGE_OWNER/mcp:latest" \
    -t "ghcr.io/$IMAGE_OWNER/mcp:$IMAGE_TAG" \
    .; then
  echo "⚠️ Standard docker build failed, retrying with isolated Docker config (public base images only)..."
  TMP_DOCKER_CONFIG="$(mktemp -d)"
  trap 'rm -rf "$TMP_DOCKER_CONFIG"' EXIT

  DOCKER_CONFIG="$TMP_DOCKER_CONFIG" docker build \
      -f mcp/Dockerfile \
      -t "ghcr.io/$IMAGE_OWNER/mcp:latest" \
      -t "ghcr.io/$IMAGE_OWNER/mcp:$IMAGE_TAG" \
      .
fi

echo "✅ Build complete!"
echo "📦 Local images:"
echo "   - ghcr.io/$IMAGE_OWNER/mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/mcp:$IMAGE_TAG"