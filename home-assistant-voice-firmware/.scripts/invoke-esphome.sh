#!/usr/bin/env bash
set -euo pipefail

ACTION="$1" # compile | upload | clean
YAML_FILE="home-assistant-voice.elevenlabs.yaml"

# Optimize ESP-IDF compilation to reduce memory usage
# Single-threaded compilation and no debug symbols reduces peak memory consumption
export MAKEFLAGS="-j1"  # Single-threaded make for ESP-IDF

# Disable debug symbols to reduce memory during compilation
# Debug symbols significantly increase memory usage without being needed for releases
export CFLAGS="${CFLAGS:-} -g0"
export CXXFLAGS="${CXXFLAGS:-} -g0"

echo "ℹ️  Applying ESP-IDF build optimizations:"
echo "   - Single-threaded compilation (MAKEFLAGS=-j1)"
echo "   - Reduced debug symbols (-g0) to conserve memory"

# Collect substitutions from current environment (after 1Password injection if used)
SUB_ARGS=()
while IFS='=' read -r name value; do
	if [[ "$name" == HEY_JARVIS_* && -n "$value" ]]; then
		SUB_ARGS+=("--substitution" "$name" "$value")
	fi
done < <(env)

python3 -m esphome "${SUB_ARGS[@]}" "$ACTION" "$YAML_FILE"