#!/bin/bash
# Priority order for environment variable resolution:
# 1. op.env.local (pre-resolved secrets file) — fastest, no 1Password CLI needed
# 2. Already-set environment variables — e.g. from CI or Docker
# 3. 1Password CLI (op run) — resolves op:// references on the fly

env_file="$1"
shift

# Derive the local env file path by appending .local (e.g. mcp/op.env → mcp/op.env.local)
local_env_file="${env_file}.local"

# Priority 1: Use op.env.local if it exists (pre-resolved secrets)
if [ -f "$local_env_file" ]; then
    echo "Using pre-resolved secrets from $local_env_file"
    set -a
    source "$local_env_file"
    set +a
    exec "$@"
fi

# Check if all env vars from op.env file are present in environment
all_vars_present=true
missing_vars=()
while IFS='=' read -r var_name var_value || [ -n "$var_name" ]; do
    # Skip empty lines and comments
    if [[ -z "$var_name" || "$var_name" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    
    # Check if this environment variable is set
    if [ -z "${!var_name}" ]; then
        all_vars_present=false
        missing_vars+=("$var_name")
    fi
done < "$env_file"

# Priority 2: All variables already in environment
if [ "$all_vars_present" = true ]; then
    exec "$@"
fi

# Priority 3: Fall back to 1Password CLI
echo "Missing environment variables, so falling back to 1Password CLI: ${missing_vars[*]}..."

# Check if 1Password CLI is signed in
op account get &> /dev/null
if [ $? -ne 0 ]; then
    echo "❌ 1Password CLI is not signed in - run: eval \$(op signin)"
    exit 1
fi

# Create a temporary env file that includes current environment + op.env
temp_env_file=$(mktemp)
trap "rm -f '$temp_env_file'" EXIT

# Export current environment variables (filter out functions and problematic vars)
while IFS='=' read -r name value; do
    # Only include simple variables
    if [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        echo "$name=$value" >> "$temp_env_file"
    fi
done < <(env)

# Append the original env file (allows 1Password references to override)
cat "$env_file" >> "$temp_env_file"

exec op run --env-file="$temp_env_file" --no-masking -- "$@"
