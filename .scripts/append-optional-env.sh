#!/bin/bash
# Appends the references from an optional env file that 1Password can actually resolve.
# Usage: append-optional-env.sh <optional-env-file> <target-env-file>
#
# An optional reference is one whose absence should switch a single feature off — the coding
# vertical's Claude Code host, for instance — rather than stop the whole process. `op run` fails on
# the first reference it cannot resolve, so each one is tested on its own first, with `op read`,
# and only the ones that resolve are appended. The value `op read` prints is discarded unseen: only
# the reference passes through here, and `op run` resolves it again later.
#
# A variable already set in the environment is left alone, just as it would be for op.env.

optional_env_file="$1"
target_env_file="$2"

if [ ! -f "$optional_env_file" ]; then
    exit 0
fi

reference_pattern='^([A-Za-z_][A-Za-z0-9_]*)="?(op://[^"]+)"?$'

while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
        continue
    fi

    if [[ ! "$line" =~ $reference_pattern ]]; then
        echo "⚠️ Skipping a line of $optional_env_file that is not NAME=\"op://...\""
        continue
    fi

    var_name="${BASH_REMATCH[1]}"
    reference="${BASH_REMATCH[2]}"

    if [ -n "${!var_name}" ]; then
        continue
    fi

    if op read "$reference" > /dev/null 2>&1; then
        echo "$line" >> "$target_env_file"
    else
        echo "⚠️ Optional $var_name is not set: $reference could not be resolved"
    fi
done < "$optional_env_file"
