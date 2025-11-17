#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

# Configure git safe.directory to avoid ownership issues
git config --global --add safe.directory /workspaces/hey-jarvis

# Ensure Bun is in PATH
# The Bun feature installs to /usr/local/bin or ~/.bun/bin depending on the user
if command -v bun &> /dev/null; then
    echo "✓ Bun found at: $(which bun)"
elif [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    echo "✓ Added Bun to PATH from $HOME/.bun/bin"
elif [ -f "/home/node/.bun/bin/bun" ]; then
    export PATH="/home/node/.bun/bin:$PATH"
    echo "✓ Added Bun to PATH from /home/node/.bun/bin"
else
    echo "❌ Bun not found. Please ensure Bun devcontainer feature is installed."
    exit 1
fi

echo "🔧 Installing dependencies with Bun..."
if [ -f "bun.lock" ]; then
    bun install --frozen-lockfile || {
        echo "❌ bun install failed"
        exit 1
    }
else
    bun install || {
        echo "❌ bun install failed"
        exit 1
    }
fi

# Skip Playwright installation by default - can be installed manually when needed
# This significantly reduces DevContainer build time
# To install manually: npx playwright install --with-deps chromium

echo "🚀 Running project initialization..."

# In CI environments, skip heavy initialization tasks (like ESPHome toolchain download)
# to avoid OOM issues. The build will handle any needed initialization.
if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "ℹ️  CI environment detected - skipping initialize targets to conserve memory"
    echo "   Projects will initialize on-demand during build/test"
else
    # Run init with proper error handling
    # Use --parallel=false to avoid race conditions
    nx run-many --target=initialize --parallel=false || {
        echo "⚠️  Some init targets failed (exit code: $?)"
        echo "   You can manually run: npx nx run PROJECT:init"
        exit 0  # Don't fail the devcontainer creation
    }
fi

echo "✅ DevContainer initialization complete!"
