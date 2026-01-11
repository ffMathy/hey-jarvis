#!/bin/sh
# Health check script for Docker container
# Verifies that Mastra Server API, MCP Server, and Mastra Studio UI are responding
# Checks internal ports directly since this runs inside the container

set -e

echo "Checking Mastra server API on internal port 8111..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:8111/health 2>/dev/null; then
    echo "ERROR: Mastra server API (internal port 8111) is not responding"
    exit 1
fi
echo "✓ Mastra server API is healthy"

echo "Checking MCP server on internal port 8112..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:8112/health 2>/dev/null; then
    echo "ERROR: MCP server (internal port 8112) is not responding"
    exit 1
fi
echo "✓ MCP server is healthy"

echo "Checking Mastra Studio UI on internal port 8113..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:8113 2>/dev/null; then
    echo "ERROR: Mastra Studio UI (internal port 8113) is not responding"
    exit 1
fi
echo "✓ Mastra Studio UI is healthy"

echo "✓ All services are healthy"
exit 0
