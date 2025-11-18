#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

# Configure git safe.directory to avoid ownership issues
git config --global --add safe.directory /workspaces/hey-jarvis

echo "🔧 Installing dependencies with Bun..."
bun install --frozen-lockfile || {
    echo "❌ bun install failed"
    exit 1
}

# Skip Playwright installation by default - can be installed manually when needed
# This significantly reduces DevContainer build time
# To install manually: npx playwright install --with-deps chromium

echo "✅ DevContainer initialization complete!"
