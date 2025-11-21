#!/bin/bash
# Check if all environment variables from .env file are already set
# If yes, run directly
# If no, use 1Password CLI

env_file="$1"
shift

# Check if all env vars from .env file are present in environment
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

if [ "$all_vars_present" = true ]; then
    exec "$@"
else
    echo "Missing environment variables, so falling back to 1Password CLI: ${missing_vars[*]}..."
    
    # In CI environments, if 1Password is not available, skip gracefully for optional tasks
    if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
        echo "⚠️  Running in GitHub Actions without 1Password - skipping optional command"
        exit 0
    fi
    
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
fi
