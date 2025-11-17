#!/usr/bin/env bash
set -euo pipefail

ACTION="$1" # compile | upload | clean
YAML_FILE="home-assistant-voice.elevenlabs.yaml"

# Limit parallel compilation jobs in CI to conserve memory
# GitHub Actions runners have 7GB RAM and ESP-IDF compilation can be memory-intensive
if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    export MAKEFLAGS="-j1"  # Single-threaded make for ESP-IDF
    echo "ℹ️  CI environment detected - limiting compilation to 1 parallel job to prevent OOM"
fi

# Collect substitutions from current environment (after 1Password injection if used)
SUB_ARGS=()
while IFS='=' read -r name value; do
	if [[ "$name" == HEY_JARVIS_* && -n "$value" ]]; then
		SUB_ARGS+=("--substitution" "$name" "$value")
	fi
done < <(env)

python3 -m esphome "${SUB_ARGS[@]}" "$ACTION" "$YAML_FILE"