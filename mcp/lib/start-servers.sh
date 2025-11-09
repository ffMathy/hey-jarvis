#!/usr/bin/env bash
# ==============================================================================
# Shared function to start MCP servers
# Used by both production (run.sh) and test (run-test.sh) entrypoints
# ==============================================================================

start_mcp_servers() {
    echo "Starting Mastra development server on port 4111..." >&2
    echo "Starting J.A.R.V.I.S. MCP server on port 4112..." >&2
    
    # Run both mastra dev (port 4111) and mcp-server (port 4112) in parallel
    # Using & to run in background and wait to keep the script alive
    # Ports are hardcoded: Mastra=4111, MCP=4112
    cd /workspace
    
    echo "Current directory: $(pwd)" >&2
    echo "Checking for required files..." >&2
    [ -d "mcp/mastra" ] && echo "✓ mcp/mastra directory exists" >&2 || echo "✗ mcp/mastra directory missing" >&2
    [ -f "mcp/mastra/mcp-server.ts" ] && echo "✓ mcp/mastra/mcp-server.ts exists" >&2 || echo "✗ mcp/mastra/mcp-server.ts missing" >&2
    
    echo "Starting Mastra dev server..." >&2
    PORT=4111 mastra dev --dir mcp/mastra --root . 2>&1 | sed 's/^/[MASTRA] /' &
    MASTRA_PID=$!
    
    echo "Starting MCP server..." >&2
    npx tsx mcp/mastra/mcp-server.ts 2>&1 | sed 's/^/[MCP] /' &
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
