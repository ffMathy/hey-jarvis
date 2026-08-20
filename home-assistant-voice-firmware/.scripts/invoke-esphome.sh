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
run_esphome() {
	local action="$1"
	shift
	echo "▶️  esphome $action $YAML_FILE ${*:-} ($(( ${#SUB_ARGS[@]} / 2 )) substitutions, values hidden)"
	"${ESPHOME_CMD[@]}" "${SUB_ARGS[@]}" "$action" "$YAML_FILE" "$@"
}

# Refuse to flash a build that still has placeholder credentials baked into it.
#
# build.sh compiles with `build-placeholder-*` values on purpose, so that a plain
# compile check needs no secrets. Those values are string literals in the firmware, so
# a device flashed with one cannot join WiFi at all: it scans, fails, and ESPHome's
# wifi reboot_timeout restarts it on a loop. That looks exactly like a memory leak from
# the outside, down to a click from the speaker on every boot.
#
# Checked against the binary rather than the environment, so it holds however the
# artifact was produced -- including a stale one left in the build directory.
assert_no_placeholder_credentials() {
	local bin
	# `|| true` because set -o pipefail would otherwise abort the script on no match,
	# skipping the explanatory error below.
	bin="$(ls -1 .esphome/build/*/build/firmware.factory.bin 2> /dev/null | head -n1)" || true

	if [ -z "$bin" ]; then
		echo "❌ No firmware.factory.bin found to verify before flashing."
		echo "   Expected one under .esphome/build/*/build/ after a compile."
		exit 1
	fi

	if grep -aq "build-placeholder-" "$bin"; then
		echo "❌ Refusing to flash: $bin still contains placeholder credentials."
		echo
		echo "   It was built by .scripts/build.sh, which substitutes 'build-placeholder-*'"
		echo "   so a compile check needs no secrets. Flashing it gives a device that can"
		echo "   never join WiFi and reboots every reboot_timeout."
		echo
		echo "   Build with real values instead:"
		echo "     bash .scripts/flash-usb.sh compile"
		exit 1
	fi
}

case "$ACTION" in
	upload | run)
		# `esphome upload` does NOT compile -- it flashes whatever is already in the
		# build directory. Compile first, under this command's credentialed
		# environment, so the artifact about to be flashed is the one this config
		# actually describes. A no-op when it is already up to date.
		run_esphome compile
		assert_no_placeholder_credentials
		;;
esac

run_esphome "$ACTION" "${EXTRA_ARGS[@]}"
