#!/bin/sh
set -e

# Rebuild native modules for the target architecture
# This is necessary for multi-architecture Docker images where native modules
# like @anush008/tokenizers need to be compiled for the specific platform
echo "Rebuilding native modules for current architecture..."

# Only rebuild if the native module is missing (e.g., on ARM64)
# This makes startup faster when not needed
if ! node -e "require('@anush008/tokenizers')" 2>/dev/null; then
    echo "Native tokenizers module missing or incompatible, rebuilding..."
    npm rebuild @anush008/tokenizers fastembed 2>&1 || {
        echo "Warning: Failed to rebuild native modules. Trying full rebuild..."
        npm rebuild 2>&1 || echo "Warning: Rebuild failed, continuing anyway..."
    }
else
    echo "Native modules already compatible, skipping rebuild"
fi

# Execute the main command
exec "$@"
