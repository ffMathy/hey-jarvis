#!/bin/bash
# Generate consolidated .env file for DevContainer from host environment variables
# This script captures all HEY_JARVIS_* environment variables from the host system

set -e

echo "Generating consolidated .env file for DevContainer..."

# Root directory of the repository
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

# Remove existing .env file if it exists
if [ -f "$ENV_FILE" ]; then
    rm "$ENV_FILE"
fi

# Always create the .env file, even if empty, to avoid Docker errors
touch "$ENV_FILE"

# Create header comment
cat > "$ENV_FILE" << 'EOF'
# Auto-generated DevContainer environment file
# This file captures all HEY_JARVIS_* environment variables from the host system
# DO NOT EDIT MANUALLY - regenerated on DevContainer creation
EOF

# Get all environment variables that start with HEY_JARVIS_
HEY_JARVIS_VARS=$(env | grep "^HEY_JARVIS_" || true)

if [ -n "$HEY_JARVIS_VARS" ]; then
    echo "" >> "$ENV_FILE"
    echo "# HEY_JARVIS_* environment variables from host system" >> "$ENV_FILE"
    echo "$HEY_JARVIS_VARS" >> "$ENV_FILE"
    
    # Count the variables
    VAR_COUNT=$(echo "$HEY_JARVIS_VARS" | wc -l)
    echo "Successfully captured $VAR_COUNT HEY_JARVIS_* environment variables from host"
else
    echo "" >> "$ENV_FILE"
    echo "# No HEY_JARVIS_* environment variables found in host environment" >> "$ENV_FILE"
    echo "Warning: No HEY_JARVIS_* environment variables found in host environment"
fi

echo "DevContainer .env generation complete."