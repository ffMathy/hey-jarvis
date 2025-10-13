#!/bin/bash
# DevContainer initialization script
# Installs dependencies and runs project-specific initialization

echo "🔧 Installing npm dependencies..."
npm install || {
    echo "❌ npm install failed"
    exit 1
}

echo "🚀 Running project initialization..."

# Run init with proper error handling
# Use --parallel=false to avoid race conditions
nx affected --target=init --parallel=false || {
    echo "⚠️  Some init targets failed (exit code: $?)"
    echo "   You can manually run: npx nx run PROJECT:init"
    exit 0  # Don't fail the devcontainer creation
}

echo "✅ DevContainer initialization complete!"
