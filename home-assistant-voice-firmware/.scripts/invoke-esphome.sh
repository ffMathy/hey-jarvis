#!/usr/bin/env bash
set -euo pipefail

# Usage: invoke-esphome.sh <action> [extra esphome args...]
#   action: compile | upload | run | logs | clean
#
# Set ESPHOME_DEVICE to target a specific port instead of ESPHome's auto-detect,
# e.g. ESPHOME_DEVICE=/dev/ttyACM0 for a USB-attached device, or an IP/hostname
# for OTA. Under WSL the device must first be attached with usbipd-win — see
# .scripts/setup-wsl.sh.
if [ $# -eq 0 ]; then
	echo "❌ Usage: invoke-esphome.sh <compile|upload|run|logs|clean> [extra esphome args...]"
	exit 1
fi
ACTION="$1"
shift
EXTRA_ARGS=("$@")
YAML_FILE="home-assistant-voice.elevenlabs.yaml"

# Prefer a standalone `esphome` binary (uv/pipx install it that way, on a Python
# new enough for current ESPHome). Fall back to the system interpreter.
if command -v esphome > /dev/null 2>&1; then
	ESPHOME_CMD=(esphome)
elif python3 -c 'import esphome' > /dev/null 2>&1; then
	ESPHOME_CMD=(python3 -m esphome)
else
	echo "❌ ESPHome is not installed."
	echo "   WSL/Linux: bash .scripts/setup-wsl.sh   (installs it on Python 3.12 via uv)"
	echo "   Otherwise: uv tool install esphome --python 3.12"
	exit 1
fi

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

# --device is a per-command flag, so it belongs after the YAML file.
if [ -n "${ESPHOME_DEVICE:-}" ]; then
	case "$ACTION" in
		upload | run | logs)
			echo "ℹ️  Targeting device: $ESPHOME_DEVICE"
			EXTRA_ARGS+=("--device" "$ESPHOME_DEVICE")
			;;
	esac
fi

# Deliberately NOT `set -x` here. SUB_ARGS carries resolved secret VALUES (the WiFi
# password, API keys, tokens), so tracing would print every one of them to the
# console and into CI logs — and run-with-env.sh invokes `op run --no-masking`, so
# nothing downstream would redact them. Log the action without the substitutions.
echo "▶️  esphome $ACTION $YAML_FILE ${EXTRA_ARGS[*]:-} ($(( ${#SUB_ARGS[@]} / 2 )) substitutions, values hidden)"
"${ESPHOME_CMD[@]}" "${SUB_ARGS[@]}" "$ACTION" "$YAML_FILE" "${EXTRA_ARGS[@]}"
