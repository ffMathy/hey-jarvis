#!/bin/sh
# Health check script for Docker container
# Automatically detects which ports are in use and checks accordingly

set -e

# Check if port 8111 is listening (internal mode)
# or port 4111 is listening (default mode)
# Both configurations use mastra dev which serves API and Studio UI together
if nc -z localhost 8111 2>/dev/null; then
    echo "Checking Mastra dev on internal port 8111 (addon mode)..."
    if ! wget --spider --timeout=5 --tries=1 http://localhost:8111/health 2>/dev/null; then
        echo "ERROR: Mastra dev (internal port 8111) is not responding"
        exit 1
    fi
    echo "✓ Mastra dev is healthy"
elif nc -z localhost 4111 2>/dev/null; then
    echo "Checking Mastra dev on port 4111 (base container mode)..."
    if ! wget --spider --timeout=5 --tries=1 http://localhost:4111/health 2>/dev/null; then
        echo "ERROR: Mastra dev (port 4111) is not responding"
        exit 1
    fi
    echo "✓ Mastra dev is healthy"
else
    echo "ERROR: Mastra dev is not listening on expected ports (8111 or 4111)"
    exit 1
fi

echo "Checking MCP server on internal port 8112..."
if ! wget --spider --timeout=5 --tries=1 http://localhost:8112/health 2>/dev/null; then
    echo "ERROR: MCP server (internal port 8112) is not responding"
    exit 1
fi
echo "✓ MCP server is healthy"

echo "✓ All services are healthy"
exit 0
