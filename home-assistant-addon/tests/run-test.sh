#!/usr/bin/env bash
# ==============================================================================
# Test entrypoint for E2E testing with nginx ingress simulation
# Starts nginx, Mastra UI, and MCP server via supervisord
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

# Use test-specific supervisord config that includes nginx
export SUPERVISORD_CONFIG=/etc/supervisord-test.conf

echo "==========================="
echo "Starting all services via supervisord..."
echo "==========================="

# Start all services (nginx, Mastra UI, MCP server) using supervisord
# This will exec and replace the current process
start_mastra
