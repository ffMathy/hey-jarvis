#!/bin/bash
# Generate consolidated .env file for DevContainer from project-specific .env files
# This script combines all HEY_JARVIS_* environment variables from project .env files

set -e

echo "Generating consolidated .env file for DevContainer..."

# Root directory of the repository
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

# Remove existing .env file if it exists
if [ -f "$ENV_FILE" ]; then
    rm "$ENV_FILE"
fi

# Create header comment
cat > "$ENV_FILE" << 'EOF'
# Auto-generated DevContainer environment file
# This file is generated from project-specific .env files for DevContainer use
# DO NOT EDIT MANUALLY - regenerated on DevContainer creation
EOF

# Function to extract and add env vars from a .env file
add_env_vars_from_file() {
    local env_file="$1"
    local project_name="$2"
    
    if [ -f "$env_file" ]; then
        echo "" >> "$ENV_FILE"
        echo "# Environment variables from $project_name" >> "$ENV_FILE"
        
        # Extract lines that start with HEY_JARVIS_ (ignoring comments and empty lines)
        grep "^HEY_JARVIS_" "$env_file" >> "$ENV_FILE" || true
    fi
}

# Add environment variables from each project
add_env_vars_from_file "$ROOT_DIR/jarvis-mcp/.env" "jarvis-mcp"
add_env_vars_from_file "$ROOT_DIR/elevenlabs/.env" "elevenlabs"

# Check if any HEY_JARVIS_ variables were found and added
if ! grep -q "^HEY_JARVIS_" "$ENV_FILE" 2>/dev/null; then
    echo "Warning: No HEY_JARVIS_* environment variables found in project .env files"
else
    echo "Successfully generated $ENV_FILE with consolidated environment variables"
fi

echo "DevContainer .env generation complete."