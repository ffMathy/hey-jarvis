#!/usr/bin/env bash
# ==============================================================================
# Shared functions to start MCP servers
# Used by both production (run.sh) and test (run-test.sh) entrypoints
# ==============================================================================

# Source centralized port configuration
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/ports.sh"

# Kill any process listening on the specified port
kill_process_on_port() {
    local port=$1
    local pids
    
    # Find PIDs listening on the port (works on Linux)
    pids=$(lsof -ti ":${port}" 2>/dev/null || true)
    
    if [ -n "$pids" ]; then
        echo "🧹 Killing process(es) on port ${port}: ${pids}" >&2
        for pid in $pids; do
            kill -9 "$pid" 2>/dev/null || true
        done
        # Give it a moment to clean up
        sleep 0.5
    fi
}

start_mcp_servers() {
    echo "Starting Mastra development server on port ${MASTRA_UI_PORT}..." >&2
    echo "Starting J.A.R.V.I.S. MCP server on port ${MCP_SERVER_PORT}..." >&2
    
    # Export environment variables for supervisord
    export MASTRA_UI_PORT
    export MCP_SERVER_PORT
    
    # Check if we should use supervisord (default: yes if available)
    # Can be disabled by setting USE_SUPERVISORD=false
    USE_SUPERVISORD=${USE_SUPERVISORD:-true}
    
    if [ "$USE_SUPERVISORD" = "true" ] && command -v supervisord > /dev/null 2>&1; then
        echo "Using supervisord to manage processes and forward logs..." >&2
        # Start supervisord which will manage both processes
        # supervisord will run in foreground (nodaemon=true in config)
        # and properly forward logs from both processes
        # Using exec replaces the current shell with supervisord
        exec /usr/bin/supervisord -c /etc/supervisord.conf
    else
        # Fallback to original implementation for backwards compatibility
        echo "Using background processes (supervisord disabled or not available)..." >&2
        # Run both mastra dev and mcp-server in parallel
        # Services now listen directly on their external ports
        # Using & to run in background and wait to keep the script alive
        cd /workspace
        
        echo "Current directory: $(pwd)" >&2
        echo "Starting Mastra dev server..." >&2
        PORT=${MASTRA_UI_PORT} HOST=0.0.0.0 bunx mastra dev --dir mcp/mastra --root . &
        MASTRA_PID=$!
        
        echo "Starting MCP server..." >&2
        PORT=${MCP_SERVER_PORT} HOST=0.0.0.0 bun run mcp/mastra/mcp-server.ts &
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
    fi
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
