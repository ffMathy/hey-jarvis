#!/bin/bash
set -e

# Home Assistant Addon Deployment Script
# Pushes Docker images to GitHub Container Registry

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
GITHUB_SHA="${GITHUB_SHA:-latest}"

echo "📋 Deployment configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   GitHub SHA: $GITHUB_SHA"
echo "   GitHub Actor: $GITHUB_ACTOR"

# Login to GitHub Container Registry
echo "🔐 Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# Get current version from config.json
CURRENT_VERSION=$(grep '"version"' "$PROJECT_DIR/config.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo "📦 Current version: $CURRENT_VERSION"

# Push images with version tags
echo "📤 Pushing Docker images..."

# Push with SHA tag
docker push "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$GITHUB_SHA"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/home-assistant-addon:$GITHUB_SHA"

# Push with version tag
docker tag "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$GITHUB_SHA" "ghcr.io/$IMAGE_OWNER/home-assistant-addon:v$CURRENT_VERSION"
docker push "ghcr.io/$IMAGE_OWNER/home-assistant-addon:v$CURRENT_VERSION"
echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/home-assistant-addon:v$CURRENT_VERSION"

# Push as latest if on main branch
if [ "${GITHUB_REF:-}" = "refs/heads/main" ] || [ -z "${GITHUB_REF:-}" ]; then
    docker tag "ghcr.io/$IMAGE_OWNER/home-assistant-addon:$GITHUB_SHA" "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
    docker push "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
    echo "✅ Pushed: ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
fi

echo "🎉 Deployment complete!"
echo "📦 Available tags:"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:$GITHUB_SHA"
echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:v$CURRENT_VERSION"
if [ "${GITHUB_REF:-}" = "refs/heads/main" ] || [ -z "${GITHUB_REF:-}" ]; then
    echo "   - ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"
fi