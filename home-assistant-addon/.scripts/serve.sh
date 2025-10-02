#!/bin/bash
set -e

# Home Assistant Addon Serve Script
# Runs the addon Docker container locally

# Set defaults for optional environment variables
IMAGE_OWNER="${IMAGE_OWNER:-ffmathy}"

echo "🚀 Starting Hey Jarvis Home Assistant Addon locally..."
echo "📋 Configuration:"
echo "   Image Owner: $IMAGE_OWNER"
echo "   Container Port: 4111"

# Run the Docker container
echo "🐳 Starting Docker container..."
docker run --rm -p 4111:4111 --name hey-jarvis-addon "ghcr.io/$IMAGE_OWNER/home-assistant-addon:latest"