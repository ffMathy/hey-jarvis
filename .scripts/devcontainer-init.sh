#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

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

# Run init with proper error handling
# Use --parallel=false to avoid race conditions
nx run-many --target=initialize --parallel=false || {
    echo "⚠️  Some init targets failed (exit code: $?)"
    echo "   You can manually run: npx nx run PROJECT:init"
    exit 0  # Don't fail the devcontainer creation
}

echo "✅ DevContainer initialization complete!"
