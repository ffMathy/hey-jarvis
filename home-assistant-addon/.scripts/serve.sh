#!/bin/bash
set -e

# Home Assistant Addon Serve Script
# Runs the addon Docker container locally

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"

echo "🚀 Starting Hey Jarvis Home Assistant Addon locally..."
echo "📋 Configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Container Port: 41111"

# Run the Docker container
echo "🐳 Starting Docker container..."
docker rm -f hey-jarvis-addon 2>/dev/null || true
docker run --rm -p 41111:4111 --name hey-jarvis-addon -e HEY_JARVIS_GOOGLE_API_KEY=foo "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"