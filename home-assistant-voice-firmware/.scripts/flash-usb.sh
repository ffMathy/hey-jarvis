#!/usr/bin/env bash
set -euo pipefail

# Build and flash the firmware to a USB-attached Home Assistant Voice PE, then
# stream serial logs. Requires real WiFi credentials, so it goes through
# 1Password (unlike the plain `build`, which only needs placeholders).
#
# `upload` and `run` both recompile first, under those real credentials, because
# `esphome upload` on its own flashes whatever binary is already in the build
# directory -- which after a `build` is one carrying placeholder credentials.
# invoke-esphome.sh also refuses outright to flash such a binary.
#
# Usage:
#   bun run --cwd home-assistant-voice-firmware flash            # auto-detect port
#   ESPHOME_DEVICE=/dev/ttyACM0 bun run --cwd ... flash          # explicit port
#
# Under WSL the device must be attached from an ADMIN Windows terminal first:
#   usbipd list
#   usbipd bind   --busid <BUSID>
#   usbipd attach --wsl --busid <BUSID>

ACTION="${1:-run}"

detect_device() {
	local candidate
	for candidate in /dev/ttyACM* /dev/ttyUSB*; do
		[ -e "$candidate" ] && { printf '%s' "$candidate"; return 0; }
	done
	return 1
}

if [ -z "${ESPHOME_DEVICE:-}" ]; then
	if device="$(detect_device)"; then
		export ESPHOME_DEVICE="$device"
		echo "🔌 Auto-detected device: $ESPHOME_DEVICE"
	else
		echo "❌ No /dev/ttyACM* or /dev/ttyUSB* device found."
		if grep -qi microsoft /proc/version 2> /dev/null; then
			echo
			echo "   You are in WSL, where USB devices must be forwarded explicitly."
			echo "   In an ADMIN PowerShell on Windows:"
			echo "     usbipd list"
			echo "     usbipd bind   --busid <BUSID>   # once per device, persists"
			echo "     usbipd attach --wsl --busid <BUSID>"
			echo
			echo "   Then back in WSL, confirm the kernel picked it up:"
			echo "     sudo modprobe cdc-acm ch341 cp210x"
			echo "     ls -l /dev/ttyACM* /dev/ttyUSB*"
			echo "     dmesg | tail -20"
		fi
		exit 1
	fi
fi

if [ ! -r "$ESPHOME_DEVICE" ] || [ ! -w "$ESPHOME_DEVICE" ]; then
	echo "⚠️  $ESPHOME_DEVICE is not read/write for $(id -un)."
	echo "   Fix for this session:  sudo chmod a+rw $ESPHOME_DEVICE"
	echo "   Permanent:             sudo usermod -aG dialout $(id -un)   (then restart WSL)"
fi

# Real WiFi credentials are required here, so resolve them through 1Password.
exec bash ../.scripts/run-with-env.sh ./op.env bash ./.scripts/invoke-esphome.sh "$ACTION"
