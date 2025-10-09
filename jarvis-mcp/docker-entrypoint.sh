#!/bin/sh
set -e

# Rebuild native modules for the target architecture
# This is necessary for multi-architecture Docker images where native modules
# like @anush008/tokenizers need to be compiled for the specific platform
echo "Rebuilding native modules for current architecture..."
npm rebuild --build-from-source

# Execute the main command
exec "$@"
