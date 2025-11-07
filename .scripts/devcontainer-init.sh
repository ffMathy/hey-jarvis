#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

echo "🔧 Installing npm dependencies..."
npm install || {
    echo "❌ npm install failed"
    exit 1
}

echo "🎭 Installing Playwright browsers..."
npx playwright install --with-deps chromium || {
    echo "⚠️  Playwright browser installation failed (exit code: $?)"
    echo "   You can manually run: npx playwright install --with-deps chromium"
    # Don't fail the devcontainer creation
}

echo "🚀 Running project initialization..."

# Run init with proper error handling
# Use --parallel=false to avoid race conditions
nx run-many --target=initialize --parallel=false || {
    echo "⚠️  Some init targets failed (exit code: $?)"
    echo "   You can manually run: npx nx run PROJECT:init"
    exit 0  # Don't fail the devcontainer creation
}

echo "✅ DevContainer initialization complete!"
