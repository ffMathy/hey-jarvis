#!/usr/bin/env bash
# ==============================================================================
# Shared function to start MCP servers
# Used by both production (run.sh) and test (run-test.sh) entrypoints
# ==============================================================================

start_mcp_servers() {
    echo "Starting Mastra development server on port 4111..."
    echo "Starting J.A.R.V.I.S. MCP server on port 4112..."
    
    # Run both mastra dev (port 4111) and mcp-server (port 4112) in parallel
    # Using & to run in background and wait to keep the script alive
    # Ports are hardcoded: Mastra=4111, MCP=4112
    cd /workspace
    PORT=4111 mastra dev --dir mcp/mastra --root . &
    MASTRA_PID=$!
    
    npx tsx mcp/mastra/mcp-server.ts &
    MCP_PID=$!
    
    # Export PIDs for cleanup
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
