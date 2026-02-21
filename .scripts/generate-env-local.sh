#!/bin/bash
set -euo pipefail
# Generates a .env.local file with actual secrets resolved from 1Password CLI.
# Usage: generate-env-local.sh <op-env-file> <output-file>

op_env_file="$1"
output_file="$2"

if [ -z "$op_env_file" ] || [ -z "$output_file" ]; then
  echo "Usage: $0 <op-env-file> <output-file>"
  exit 1
fi

if [ ! -f "$op_env_file" ]; then
  echo "❌ op.env file not found: $op_env_file"
  exit 1
fi

# Check if 1Password CLI is signed in
if ! op account get &> /dev/null; then
  echo "❌ 1Password CLI is not signed in - run: eval \$(op signin)"
  exit 1
fi

# Resolve op:// references and write actual values to .env.local.
# op run sets the resolved secrets as environment variables; the inner bash
# then reads each variable name from the op.env file and writes KEY=VALUE lines.
op run --env-file "$op_env_file" --no-masking -- \
  bash -c "grep -oP '^\w+' \"$op_env_file\" | while IFS= read -r var; do printf '%s=%s\n' \"\$var\" \"\${!var}\"; done" \
  > "$output_file"

echo "✅ Generated $output_file"
