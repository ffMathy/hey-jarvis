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
    echo "Missing environment variables: ${missing_vars[*]}"
    echo "Falling back to 1Password CLI..."
    
    # Check if 1Password CLI is signed in
    op account get &> /dev/null
    if [ $? -ne 0 ]; then
        echo "❌ 1Password CLI is not signed in - run: eval \$(op signin)"
        exit 1
    fi
    
    exec op run --env-file="$env_file" --no-masking -- "$@"
fi
