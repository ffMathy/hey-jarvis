#!/bin/bash

# Start the home-assistant-addon addon container for testing
# This script handles building and starting the Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source centralized port configuration
source "$(dirname "$(dirname "$SCRIPT_DIR")")/mcp/lib/ports.sh"

# Source server functions for port management
source "$(dirname "$(dirname "$SCRIPT_DIR")")/mcp/lib/server-functions.sh"

echo "🐳 Starting home-assistant-addon addon container..."

# Kill any processes on test external ports (not service ports which may be used by local dev)
kill_process_on_port "${TEST_MASTRA_SERVER_PORT}"
kill_process_on_port "${TEST_MCP_SERVER_PORT}"
kill_process_on_port "${TEST_INGRESS_EXTERNAL_PORT}"

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
    -p "${TEST_MASTRA_SERVER_PORT}:${MASTRA_SERVER_PORT}"
    -p "${TEST_MCP_SERVER_PORT}:${MCP_SERVER_PORT}"
    -p "${TEST_INGRESS_EXTERNAL_PORT}:${TEST_INGRESS_PORT}"
    -e ADDON_INFO_FALLBACK="$ADDON_INFO"
    -e CONFIG_FALLBACK="$CONFIG"
    -e INFO_FALLBACK="$INFO"
)

# Forward all HEY_JARVIS_* and JWT_SECRET environment variables to container
# This allows tests to pass configuration without hardcoding
echo "🔑 Environment variables being forwarded to container:"
while IFS='=' read -r name value; do
    # Forward HEY_JARVIS_* prefixed variables
    if [[ "$name" =~ ^HEY_JARVIS_ ]]; then
        DOCKER_ARGS+=(-e "$name=$value")
        echo "  ✓ $name"
    fi
done < <(env)

# Start the container in the background
# (Test image is pre-built by the build target)
echo "🚀 Starting Docker container..."
CONTAINER_ID=$(docker run "${DOCKER_ARGS[@]}" home-assistant-addon-test)

echo "📦 Container ID: $CONTAINER_ID"

# Give container a moment to start
sleep 2

echo "🎯 Addon container is running and ready for testing!"
echo "Press Ctrl+C to stop the container."

# Monitor container health and keep script running
echo "📊 Monitoring container health (Container ID: $CONTAINER_ID)..."
while true; do
    # Check if container is still running using container ID
    if ! docker ps -q --filter "id=$CONTAINER_ID" | grep -q .; then
        echo "❌ Container has stopped unexpectedly!"
        echo "📋 Container logs:"
        docker logs "$CONTAINER_ID" || docker logs home-assistant-addon-test
        exit 1
    fi
    
    sleep 5
done
