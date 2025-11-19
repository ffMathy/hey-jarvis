#!/usr/bin/env bash
# ==============================================================================
# Shared functions to start MCP servers
# Used by both production (run.sh) and test (run-test.sh) entrypoints
# ==============================================================================

# Source centralized port configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/ports.sh"

start_mcp_servers() {
    echo "Starting Mastra development server on internal port ${MASTRA_UI_INTERNAL_PORT}..." >&2
    echo "Starting J.A.R.V.I.S. MCP server on internal port ${MCP_SERVER_INTERNAL_PORT}..." >&2
    
    # Run both mastra dev and mcp-server in parallel
    # Nginx exposes these on ports ${MASTRA_UI_PORT} and ${MCP_SERVER_PORT} externally
    # Using & to run in background and wait to keep the script alive
    cd /workspace
    
    echo "Current directory: $(pwd)" >&2
    echo "Starting Mastra dev server..." >&2
    PORT=${MASTRA_UI_INTERNAL_PORT} bunx mastra dev --dir mcp/mastra --root . 2>&1 &
    MASTRA_PID=$!
    
    echo "Starting MCP server..." >&2
    PORT=${MCP_SERVER_INTERNAL_PORT} HOST=0.0.0.0 bun run mcp/mastra/mcp-server.ts 2>&1 &
    MCP_PID=$!
    
    # Give servers a moment to start
    sleep 3
    
    # Check if processes are still running
    if ! kill -0 $MASTRA_PID 2>/dev/null; then
        echo "ERROR: Mastra server failed to start or exited immediately" >&2
        return 1
    fi
    
    if ! kill -0 $MCP_PID 2>/dev/null; then
        echo "ERROR: MCP server failed to start or exited immediately" >&2
        return 1
    fi
    
    # Export PIDs for cleanup (only output to stdout)
    echo "$MASTRA_PID $MCP_PID"
}

wait_for_server_exit() {
    local mastra_pid=$1
    local mcp_pid=$2
    
    # Wait for either process to exit
    wait -n
    EXIT_CODE=$?
    
    echo "A server process has exited with code ${EXIT_CODE}"
    
    # Check which process(es) stopped
    MASTRA_RUNNING=true
    MCP_RUNNING=true
    
    if ! kill -0 $mastra_pid 2>/dev/null; then
        MASTRA_RUNNING=false
        echo "Mastra development server has stopped"
    fi
    
    if ! kill -0 $mcp_pid 2>/dev/null; then
        MCP_RUNNING=false
        echo "J.A.R.V.I.S. MCP server has stopped"
    fi
    
    if [ "$MASTRA_RUNNING" = false ] && [ "$MCP_RUNNING" = false ]; then
        echo "Both servers have stopped"
    fi
    
    return $EXIT_CODE
}
