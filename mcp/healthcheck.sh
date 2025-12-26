#!/bin/sh
# Health check script for Docker container
# Verifies that Mastra Server (4111), MCP Server (4112), and Studio UI (3000) are responding

set -e

echo "Checking Mastra server API on port 4111..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:4111/health 2>/dev/null; then
    echo "ERROR: Mastra server API (port 4111) is not responding"
    exit 1
fi
echo "✓ Mastra server API is healthy"

echo "Checking MCP server on port 4112..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:4112 2>/dev/null; then
    echo "ERROR: MCP server (port 4112) is not responding"
    exit 1
fi
echo "✓ MCP server is healthy"

echo "Checking Mastra Studio UI on port 3000..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:3000 2>/dev/null; then
    echo "⚠ Mastra Studio UI (port 3000) is not responding (optional service)"
    # Don't exit 1 here since Studio is optional
else
    echo "✓ Mastra Studio UI is healthy"
fi

echo "✓ All required services are healthy"
exit 0
