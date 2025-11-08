#!/bin/bash

# Start the home-assistant-addon addon container for testing
# This script handles building and starting the Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🐳 Starting home-assistant-addon addon container..."

# Function to cleanup Docker container
cleanup() {
    echo "🧹 Cleaning up Docker container..."
    docker stop home-assistant-addon-test 2>/dev/null || true
    docker rm home-assistant-addon-test 2>/dev/null || true
    exit
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Check if container is already running
if docker ps | grep -q "home-assistant-addon-test"; then
    echo "⚠️  Stopping existing container..."
    docker stop home-assistant-addon-test
    docker rm home-assistant-addon-test
fi

# Read test configuration files
ADDON_INFO=$(cat "$SCRIPT_DIR/supervisor/addon-info.json")
CONFIG=$(cat "$SCRIPT_DIR/supervisor/config.json")
INFO=$(cat "$SCRIPT_DIR/supervisor/info.json")

# Start the container in the background
# (Test image is pre-built by the build target)
echo "🚀 Starting Docker container..."
docker run \
    --rm \
    --detach \
    --name home-assistant-addon-test \
    -p 5000:5000 \
    -p 5690:5690 \
    -e ADDON_INFO_FALLBACK="$ADDON_INFO" \
    -e CONFIG_FALLBACK="$CONFIG" \
    -e INFO_FALLBACK="$INFO" \
    home-assistant-addon-test

# Wait for the container to be ready
echo "⏳ Waiting for container to be ready..."
max_attempts=60
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5690 | grep -q "200\|404\|302"; then
        echo "✅ Container is ready!"
        break
    fi
    
    echo "   Attempt $((attempt + 1))/$max_attempts - waiting..."
    sleep 2
    attempt=$((attempt + 1))
done

if [ $attempt -eq $max_attempts ]; then
    echo "❌ Container failed to start within timeout period"
    exit 1
fi

echo "🎯 Addon container is running and ready for testing!"
echo "Press Ctrl+C to stop the container."

# Monitor container health and keep script running
echo "📊 Monitoring container health..."
while true; do
    # Check if container is still running
    if ! docker ps | grep -q "home-assistant-addon-test"; then
        echo "❌ Container has stopped unexpectedly!"
        echo "📋 Container logs:"
        docker logs home-assistant-addon-test 2>&1 | tail -50
        exit 1
    fi
    
    sleep 5
done
