#!/bin/bash
# DevContainer initialization script
# Installs dependencies and optionally runs project-specific initialization

set -e

echo "🔧 Installing npm dependencies..."
npm install

# Check if we're running in CI environment
if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
    echo "📦 CI environment detected - skipping heavy init targets"
    echo "   (esphome/ESP-IDF toolchain installation not needed for build)"
else
    echo "🚀 Running project initialization..."
    nx run-many --target=init --all --parallel=1 || {
        echo "⚠️  Some init targets failed, but continuing..."
        echo "   You can manually run: npx nx run PROJECT:init"
    }
fi

echo "✅ DevContainer initialization complete!"
