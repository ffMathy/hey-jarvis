#!/usr/bin/env bash
set -euo pipefail

# Ensure ESPHome is available before a build.
#
# Current ESPHome requires Python >= 3.12, which many system interpreters are not
# (Ubuntu 22.04 ships 3.10). So prefer an already-installed standalone binary,
# then uv (which fetches its own 3.12), and only fall back to `pip install` when
# the system interpreter is actually new enough.

if command -v esphome > /dev/null 2>&1; then
	echo "✅ ESPHome already installed: $(esphome version 2> /dev/null | head -1)"
	exit 0
fi

if command -v uv > /dev/null 2>&1; then
	echo "ℹ️  Installing ESPHome via uv on Python 3.12"
	uv tool install --force esphome --python 3.12
	exit 0
fi

python_version="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2> /dev/null || echo "0.0")"
if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2> /dev/null; then
	echo "ℹ️  Installing ESPHome via pip (Python ${python_version})"
	python3 -m pip install --upgrade --no-cache-dir --timeout=900 esphome
	exit 0
fi

echo "❌ Python ${python_version} is too old for current ESPHome (needs >= 3.12), and uv is not installed."
echo "   WSL/Linux: bash ../.scripts/setup-wsl.sh"
echo "   Otherwise: install uv (https://astral.sh/uv) then rerun."
exit 1
