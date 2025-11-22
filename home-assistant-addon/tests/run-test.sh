#!/usr/bin/env bash
# ==============================================================================
# Test entrypoint for E2E testing with nginx ingress simulation
# Starts both nginx (to simulate Home Assistant ingress) and the MCP server
# ==============================================================================

set -e

echo "==========================="
echo "E2E Test Environment Setup"
echo "==========================="

# Source shared server start functions
# shellcheck disable=SC1091
source /workspace/mcp/lib/server-functions.sh

echo "Starting E2E test environment..."

# JWT secret is required for security
if [ -z "$HEY_JARVIS_MCP_JWT_SECRET" ]; then
    echo "ERROR: HEY_JARVIS_MCP_JWT_SECRET environment variable is required"
    exit 1
fi

echo "JWT authentication configured for testing"

# For E2E tests, directly export a test API key
# In production, these would come from bashio config
export HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY="test-api-key-for-e2e-tests"

echo "Starting Hey Jarvis servers (Mastra on ${MASTRA_UI_PORT}, MCP on ${MCP_SERVER_PORT})..."
echo "Google Generative AI API key configured (test mode)"

# Start both servers in parallel using shared function
echo "Executing start_mcp_servers function..."
PIDS=$(start_mcp_servers) || {
    echo "ERROR: Failed to start MCP servers"
    exit 1
}
read -r MASTRA_PID MCP_PID <<< "$PIDS"

# Validate PIDs are not empty
if [ -z "$MASTRA_PID" ] || [ -z "$MCP_PID" ]; then
    echo "ERROR: Failed to get server PIDs (MASTRA_PID=$MASTRA_PID, MCP_PID=$MCP_PID)"
    exit 1
fi

echo "✓ Mastra server started (PID: $MASTRA_PID)"
echo "✓ MCP server started (PID: $MCP_PID)"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down servers..."
    kill $MASTRA_PID $MCP_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "==========================="
echo "All services started successfully!"
echo "Waiting for server processes..."
echo "==========================="

# Wait for either process to exit and handle status
wait_for_server_exit "$MASTRA_PID" "$MCP_PID"
exit $?
