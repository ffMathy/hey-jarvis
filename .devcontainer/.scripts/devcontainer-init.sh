#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

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

echo "✅ DevContainer initialization complete!"
