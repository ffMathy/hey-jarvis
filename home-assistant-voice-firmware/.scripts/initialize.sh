#!/usr/bin/env bash
set -euo pipefail

# Ensure an ESPHome new enough for the firmware is available before a build.
#
# Current ESPHome requires Python >= 3.12, which many system interpreters are not
# (Ubuntu 22.04 ships 3.10). So prefer an already-installed standalone binary,
# then uv (which fetches its own 3.12), and only fall back to `pip install` when
# the system interpreter is actually new enough.
#
# An installed ESPHome only counts if it meets the config's `min_version`: ESPHome
# changes the C++ APIs the config's lambdas call (2026.10.0 made audio file ids
# const), so an older one cannot build it. Anything older is upgraded.

min_version="$(sed -n 's/^[[:space:]]*min_version:[[:space:]]*//p' home-assistant-voice.elevenlabs.yaml | head -1)"
: "${min_version:?could not read esphome.min_version from home-assistant-voice.elevenlabs.yaml}"

if command -v esphome > /dev/null 2>&1; then
	installed_version="$(esphome version 2> /dev/null | sed -n 's/^Version: //p' | head -1)"
	oldest="$(printf '%s\n%s\n' "$min_version" "$installed_version" | sort -V | head -1)"
	if [ -n "$installed_version" ] && [ "$oldest" = "$min_version" ]; then
		echo "✅ ESPHome ${installed_version} already installed (firmware needs >= ${min_version})"
		exit 0
	fi
	echo "ℹ️  Installed ESPHome (${installed_version:-version unknown}) is not >= ${min_version}, which the firmware needs; upgrading"
fi

# The version floor makes uv and pip re-resolve past an installed ESPHome that is
# too old; they still pick the latest release.
if command -v uv > /dev/null 2>&1; then
	echo "ℹ️  Installing ESPHome >= ${min_version} via uv on Python 3.12"
	uv tool install --force "esphome>=${min_version}" --python 3.12
	exit 0
fi

python_version="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2> /dev/null || echo "0.0")"
if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2> /dev/null; then
	echo "ℹ️  Installing ESPHome >= ${min_version} via pip (Python ${python_version})"
	python3 -m pip install --upgrade --no-cache-dir --timeout=900 "esphome>=${min_version}"
	exit 0
fi

echo "❌ Python ${python_version} is too old for current ESPHome (needs >= 3.12), and uv is not installed."
echo "   WSL/Linux: bash ../.scripts/setup-wsl.sh"
echo "   Otherwise: install uv (https://astral.sh/uv) then rerun."
exit 1
