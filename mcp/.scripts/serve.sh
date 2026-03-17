#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if ! command -v supervisord &>/dev/null; then
    echo "📦 Installing supervisor..."
    sudo apt-get install -y supervisor -qq
fi

echo "🚀 Starting both services via supervisord..."
echo "   Port 4111: Mastra Server + Studio"
echo "   Port 4112: MCP Server"

exec supervisord -c "$SCRIPT_DIR/../supervisord.conf"
