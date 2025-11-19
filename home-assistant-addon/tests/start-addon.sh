#!/bin/bash

# Start the home-assistant-addon addon container for testing
# This script handles building and starting the Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source centralized port configuration
source "$(dirname "$(dirname "$SCRIPT_DIR")")/mcp/lib/ports.sh"

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
if docker ps -a | grep -q "home-assistant-addon-test"; then
    echo "⚠️  Stopping existing container..."
    docker stop home-assistant-addon-test 2>/dev/null || true
    docker rm home-assistant-addon-test 2>/dev/null || true
fi

# Read test configuration files
ADDON_INFO=$(cat "$SCRIPT_DIR/supervisor/addon-info.json")
CONFIG=$(cat "$SCRIPT_DIR/supervisor/config.json")
INFO=$(cat "$SCRIPT_DIR/supervisor/info.json")

# Build docker run command with base arguments
DOCKER_ARGS=(
    --detach
    --name home-assistant-addon-test
    -p "${TEST_INGRESS_PORT}:${TEST_INGRESS_PORT}"
    -p "${MASTRA_UI_PORT}:${MASTRA_UI_PORT}"
    -p "${MCP_SERVER_PORT}:${MCP_SERVER_PORT}"
    -e ADDON_INFO_FALLBACK="$ADDON_INFO"
    -e CONFIG_FALLBACK="$CONFIG"
    -e INFO_FALLBACK="$INFO"
)

# Add any additional environment variables passed from the caller
# Environment variables starting with JWT_ will be passed through
if [ -n "$JWT_SECRET" ]; then
    DOCKER_ARGS+=(-e JWT_SECRET="$JWT_SECRET")
fi

# Start the container in the background
# (Test image is pre-built by the build target)
echo "🚀 Starting Docker container..."
CONTAINER_ID=$(docker run "${DOCKER_ARGS[@]}" home-assistant-addon-test)

echo "📦 Container ID: $CONTAINER_ID"

# Give container a moment to start
sleep 2

# Check if container is actually running
if ! docker ps | grep -q "home-assistant-addon-test"; then
    echo "❌ Container failed to start or exited immediately!"
    echo "📋 Container logs:"
    docker logs home-assistant-addon-test 2>&1 || echo "Could not retrieve logs"
    docker rm home-assistant-addon-test 2>/dev/null || true
    exit 1
fi

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
echo "📊 Monitoring container health (Container ID: $CONTAINER_ID)..."
while true; do
    # Check if container is still running using container ID
    if ! docker ps -q --filter "id=$CONTAINER_ID" | grep -q .; then
        echo "❌ Container has stopped unexpectedly!"
        echo "📋 Container logs:"
        docker logs "$CONTAINER_ID" 2>&1 | tail -50 || docker logs home-assistant-addon-test 2>&1 | tail -50
        exit 1
    fi
    
    sleep 5
done
