#!/bin/bash
set -euo pipefail
# Generates an op.env.local file with actual secrets resolved from 1Password CLI.
# Usage: generate-env-local.sh <op-env-file>
# Output is written to <op-env-file>.local (e.g. mcp/op.env → mcp/op.env.local)

op_env_file="${1:-}"
output_file="${op_env_file}.local"

if [ -z "$op_env_file" ]; then
  echo "Usage: $0 <op-env-file>"
  exit 1
fi

if [ ! -f "$op_env_file" ]; then
  echo "❌ op.env file not found: $op_env_file"
  exit 1
fi

# Check that the 1Password CLI can authenticate. A service account token works
# non-interactively and has no "account" to get, so `op account get` is only a
# meaningful check when no token is present.
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ] && ! op account get &> /dev/null; then
  echo "❌ 1Password CLI is not authenticated. Either:"
  echo "   - interactive:  eval \$(op signin)"
  echo "   - unattended:   export OP_SERVICE_ACCOUNT_TOKEN=<token>"
  exit 1
fi

# The references to resolve: all of op.env, plus those in the sibling
# op.optional.env that resolve (see append-optional-env.sh), so a missing
# optional item leaves its variable out rather than failing the whole file.
references_file=$(mktemp)
trap 'rm -f "$references_file"' EXIT
cp "$op_env_file" "$references_file"
bash "$(dirname "${BASH_SOURCE[0]}")/append-optional-env.sh" "${op_env_file%.env}.optional.env" "$references_file"

# Resolve op:// references and write actual values to op.env.local.
# op run sets the resolved secrets as environment variables; the inner bash
# then reads each variable name from the references file and writes KEY=VALUE lines.
op run --env-file "$references_file" --no-masking -- \
  bash -c "grep -oP '^\w+' \"$references_file\" | while IFS= read -r var; do printf '%s=%s\n' \"\$var\" \"\${!var}\"; done" \
  > "$output_file"

echo "✅ Generated $output_file"
