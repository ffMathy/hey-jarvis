#!/usr/bin/env bash
set -euo pipefail

ACTION="$1" # compile | upload | clean
YAML_FILE="home-assistant-voice.elevenlabs.yaml"

# Limit parallel compilation jobs and optimize build for CI environments
# GitHub Actions runners have 7GB RAM and ESP-IDF compilation can be memory-intensive
if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    export MAKEFLAGS="-j1"  # Single-threaded make for ESP-IDF
    
    # Additional ESP-IDF build optimizations for memory-constrained environments
    # Reduce compiler memory usage during optimization passes
    export CFLAGS="${CFLAGS:-} -g0"  # Disable debug symbols to reduce memory
    export CXXFLAGS="${CXXFLAGS:-} -g0"  # Disable debug symbols for C++ too
    
    echo "ℹ️  CI environment detected - applying build optimizations:"
    echo "   - Single-threaded compilation (MAKEFLAGS=-j1)"
    echo "   - Reduced debug symbols (-g0) to conserve memory"
fi

# Collect substitutions from current environment (after 1Password injection if used)
SUB_ARGS=()
while IFS='=' read -r name value; do
	if [[ "$name" == HEY_JARVIS_* && -n "$value" ]]; then
		SUB_ARGS+=("--substitution" "$name" "$value")
	fi
done < <(env)

python3 -m esphome "${SUB_ARGS[@]}" "$ACTION" "$YAML_FILE"