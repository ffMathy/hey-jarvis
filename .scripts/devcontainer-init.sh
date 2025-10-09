#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

set -e

echo "🔧 Installing npm dependencies..."
npm install

echo "🚀 Running project initialization..."

# Run init with proper error handling and timeouts
# Use --parallel=false to avoid race conditions
# Set a reasonable timeout for each init task
timeout 600 nx run-many --target=init --all --parallel=false || {
    exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo "⚠️  Initialization timed out after 10 minutes"
        echo "   This can happen with slow network connections when downloading ESP toolchains"
        echo "   You can manually run: npx nx run PROJECT:init"
        exit 0  # Don't fail the devcontainer creation
    else
        echo "⚠️  Some init targets failed (exit code: $exit_code)"
        echo "   You can manually run: npx nx run PROJECT:init"
        exit 0  # Don't fail the devcontainer creation
    fi
}

echo "✅ DevContainer initialization complete!"
