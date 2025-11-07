#!/usr/bin/env bash
# ==============================================================================
# Test entrypoint for E2E testing with nginx ingress simulation
# Starts both nginx (to simulate Home Assistant ingress) and the MCP server
# ==============================================================================

set -e

echo "Starting E2E test environment..."

# Start nginx in the background to simulate Home Assistant ingress
echo "Starting nginx proxy on port 5000..."
nginx -c /etc/nginx/home-assistant-addon-end-to-end-test.conf &
NGINX_PID=$!

# Give nginx time to start
sleep 2

# Set PORT to 5690 (the port that nginx will proxy to)
export PORT=5690

# For E2E tests, directly export a test API key
# In production, these would come from bashio config
export HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY="test-api-key-for-e2e-tests"

echo "Starting Hey Jarvis MCP Server on port ${PORT}..."
echo "Google Generative AI API key configured (test mode)"

# Start both servers in parallel
echo "Starting Mastra development server on port ${PORT}..."
echo "Starting J.A.R.V.I.S. MCP server on port 4112..."

# Run both mastra dev (port ${PORT}) and mcp-server (port 4112) in parallel
cd /workspace
mastra dev --dir mcp/mastra --root . &
MASTRA_PID=$!

npx tsx mcp/mastra/mcp-server.ts &
MCP_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "Shutting down servers..."
    kill $MASTRA_PID $MCP_PID $NGINX_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Wait for either process to exit
wait -n
EXIT_CODE=$?
echo "A server process has exited with code ${EXIT_CODE}"

exit $EXIT_CODE
