#!/usr/bin/env bash
# ==============================================================================
# Test entrypoint for E2E testing with nginx ingress simulation
# Starts both nginx (to simulate Home Assistant ingress) and the MCP server
# ==============================================================================

set -e

# Source shared server start functions
# shellcheck disable=SC1091
source /workspace/mcp/lib/start-servers.sh

echo "Starting E2E test environment..."

# Start nginx in the background to simulate Home Assistant ingress
echo "Starting nginx proxy on port 5000..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Give nginx time to start
sleep 2

# For E2E tests, directly export a test API key
# In production, these would come from bashio config
export HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY="test-api-key-for-e2e-tests"

echo "Starting Hey Jarvis servers (Mastra on 4111, MCP on 4112)..."
echo "Google Generative AI API key configured (test mode)"

# Start both servers in parallel using shared function
PIDS=$(start_mcp_servers)
read -r MASTRA_PID MCP_PID <<< "$PIDS"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down servers..."
    kill $MASTRA_PID $MCP_PID $NGINX_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Wait for either process to exit and handle status
wait_for_server_exit "$MASTRA_PID" "$MCP_PID"
exit $?
