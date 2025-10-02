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
GITHUB_SHA="${GITHUB_SHA:-latest}"

echo "📋 Deployment configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   GitHub SHA: $GITHUB_SHA"
echo "   GitHub Actor: $GITHUB_ACTOR"

# Login to GitHub Container Registry
echo "🔐 Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# Push images
echo "📤 Pushing Docker images..."

docker push "ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"

docker push "ghcr.io/$IMAGE_OWNER/jarvis-mcp:$GITHUB_SHA"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/jarvis-mcp:$GITHUB_SHA"

echo "🎉 Deployment complete!"
echo "📦 Available tags:"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:latest"
echo "   - ghcr.io/$IMAGE_OWNER/jarvis-mcp:$GITHUB_SHA"