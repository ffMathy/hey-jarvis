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

start_mastra() {
    echo "Starting Mastra server on port ${MASTRA_SERVER_PORT}..." >&2
    echo "Starting J.A.R.V.I.S. MCP server on port ${MCP_SERVER_PORT}..." >&2
    
    # Export environment variables for supervisord
    export MASTRA_SERVER_PORT
    export MCP_SERVER_PORT
    
    # Determine which supervisord config to use
    # Default to production config, but allow override for tests
    SUPERVISORD_CONFIG=${SUPERVISORD_CONFIG:-/etc/supervisord.conf}
    
    if [ ! -f "$SUPERVISORD_CONFIG" ]; then
        echo "ERROR: Supervisord config not found at $SUPERVISORD_CONFIG" >&2
        return 1
    fi
    
    echo "Using supervisord to manage processes and forward logs..." >&2
    echo "Config: $SUPERVISORD_CONFIG" >&2
    
    # Start supervisord which will manage both processes (and nginx in test mode)
    # supervisord will run in foreground (nodaemon=true in config)
    # and properly forward logs from all processes
    # Using exec replaces the current shell with supervisord
    exec /usr/bin/supervisord -c "$SUPERVISORD_CONFIG"
}

