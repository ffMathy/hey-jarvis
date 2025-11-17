#!/usr/bin/env bash
set -euo pipefail

ACTION="$1" # compile | upload | clean
YAML_FILE="home-assistant-voice.elevenlabs.yaml"

# Ensure ESPHome is installed (lazy initialization for CI environments)
if ! python3 -m esphome version &>/dev/null; then
    echo "📦 Installing ESPHome (not found)..."
    python3 -m pip install --upgrade --no-cache-dir --timeout=900 esphome
fi

# Collect substitutions from current environment (after 1Password injection if used)
SUB_ARGS=()
while IFS='=' read -r name value; do
	if [[ "$name" == HEY_JARVIS_* && -n "$value" ]]; then
		SUB_ARGS+=("--substitution" "$name" "$value")
	fi
done < <(env)

python3 -m esphome "${SUB_ARGS[@]}" "$ACTION" "$YAML_FILE"