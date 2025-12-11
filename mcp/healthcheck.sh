#!/bin/sh
# Health check script for Docker container
# Verifies that both Mastra UI (4111) and MCP Server (4112) are responding

set -e

echo "Checking Mastra server API on port 4111..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:4111/health 2>/dev/null; then
    echo "ERROR: Mastra server API (port 4111) is not responding"
    exit 1
fi
echo "✓ Mastra server API is healthy"

echo "Checking Mastra UI on port 4111..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:4111/ 2>/dev/null; then
    echo "ERROR: Mastra UI (port 4111) is not responding"
    exit 1
fi
echo "✓ Mastra UI is healthy"

echo "Checking MCP server on port 4112..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:4112 2>/dev/null; then
    echo "ERROR: MCP server (port 4112) is not responding"
    exit 1
fi
echo "✓ MCP server is healthy"

echo "✓ All services are healthy"
exit 0
