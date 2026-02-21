#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

# Fix file ownership — the DevContainer infrastructure clones files as root,
# and bun install can also create root-owned files. The container runs as
# the `node` user (uid 1000), so we need to chown everything upfront.
echo "🔑 Fixing workspace file ownership..."
sudo chown -R node:node /workspaces/hey-jarvis

# Configure git safe.directory to avoid ownership issues
git config --global --add safe.directory /workspaces/hey-jarvis
git config --global pull.rebase false

echo "🔧 Installing dependencies with Bun..."
bun install --frozen-lockfile || {
    echo "❌ bun install failed"
    exit 1
}

# Skip Playwright installation by default - can be installed manually when needed
# This significantly reduces DevContainer build time
# To install manually: npx playwright install --with-deps chromium

echo "🚀 Starting Nx Daemon..."
nx daemon --start || {
    echo "⚠️  Nx Daemon failed to start (non-fatal)"
}

# Project-level dependencies are installed with the "initialize" target in NX, lazily, when needed.

echo "📁 Copying MCP configuration to .claude directory..."
cp .mcp.json .vscode/mcp.json

echo "⚡ Installing Playwright browsers..."
bunx playwright install chrome chromium

echo "✅ DevContainer initialization complete!"