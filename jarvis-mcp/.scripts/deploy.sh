#!/bin/bash
set -e

# Jarvis MCP Deployment Script
# Pushes Docker images to GitHub Container Registry

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

# Login to GitHub Container Registry
echo "🔐 Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# Push images
echo "📤 Pushing Docker images..."

docker push "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"

docker push "ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"

echo "🎉 Deployment complete!"
echo "📦 Available tags:"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:$IMAGE_TAG"