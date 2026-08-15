#!/usr/bin/env bash
set -uo pipefail

# One-shot bootstrap so the whole repo works inside WSL: tests, deploys, and
# building/flashing the Home Assistant Voice PE over USB.
#
#   bash .scripts/setup-wsl.sh
#
# Installs (skipping anything already present):
#   - build prerequisites (curl, unzip, git)
#   - bun            -> turbo, tests, deploys
#   - 1Password CLI  -> secret resolution via op.env
#   - uv + ESPHome   -> on Python 3.12, which current ESPHome requires
#   - usbip + hwdata -> receives USB devices forwarded by usbipd-win
#
# The Windows half of USB forwarding (usbipd-win) needs an admin terminal and is
# NOT installed here; the script prints the exact commands at the end.

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }

if ! grep -qi microsoft /proc/version 2> /dev/null; then
  echo "⚠️  This does not look like WSL. Continuing anyway (it is plain Ubuntu setup)."
fi

# --- base packages ----------------------------------------------------------
log "Base packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl unzip git ca-certificates gnupg jq

# --- bun --------------------------------------------------------------------
if have bun; then
  log "bun already installed ($(bun --version))"
else
  log "Installing bun"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# --- 1Password CLI ----------------------------------------------------------
if have op; then
  log "1Password CLI already installed ($(op --version))"
else
  log "Installing 1Password CLI"
  arch="$(dpkg --print-architecture)"
  curl -sS https://downloads.1password.com/linux/keys/1password.asc \
    | sudo gpg --dearmor --yes --output /usr/share/keyrings/1password-archive-keyring.gpg
  echo "deb [arch=${arch} signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/${arch} stable main" \
    | sudo tee /etc/apt/sources.list.d/1password.list > /dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq 1password-cli
fi

# --- uv + ESPHome on Python 3.12 -------------------------------------------
# Ubuntu 22.04 ships Python 3.10, but ESPHome >= 2026.7 requires >= 3.12. uv
# fetches a standalone 3.12 rather than disturbing the system interpreter.
if ! have uv; then
  log "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

log "Installing ESPHome (Python 3.12)"
"$HOME/.local/bin/uv" tool install --force esphome --python 3.12 \
  || uv tool install --force esphome --python 3.12

# --- USB passthrough support -----------------------------------------------
# NOTE: usbipd-win >= 4.0 needs NO client tooling inside the distro; `usbipd
# attach --wsl` does everything from Windows. Do not install linux-tools here —
# it provides a Linux `usbipd` DAEMON whose name collides confusingly with the
# Windows command, and running it in WSL just prints a kernel-version warning.
#
# Serial drivers: cdc-acm covers the ESP32-S3 native USB port (VID 303a), which
# is what the Voice PE exposes; ch341/cp210x cover common USB-UART bridges.
log "Loading serial kernel modules"
for mod in vhci-hcd cdc-acm ch341 cp210x; do
  if sudo modprobe "$mod" 2> /dev/null; then echo "  ✅ $mod"; else echo "  ⚠️  $mod unavailable"; fi
done

# Persist across WSL restarts.
if [ ! -f /etc/modules-load.d/esphome-usb.conf ]; then
  printf 'vhci-hcd\ncdc-acm\nch341\ncp210x\n' | sudo tee /etc/modules-load.d/esphome-usb.conf > /dev/null
  echo "✅ Modules will load on boot"
fi

# Serial access without sudo.
if ! id -nG "$(id -un)" | grep -qw dialout; then
  sudo usermod -aG dialout "$(id -un)"
  echo "✅ Added $(id -un) to 'dialout' (restart WSL for it to take effect)"
fi

# --- report -----------------------------------------------------------------
log "Installed versions"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
for c in git bun op uv esphome; do
  printf '  %-8s %s\n' "$c" "$(command -v "$c" > /dev/null 2>&1 && "$c" --version 2>&1 | head -1 || echo 'MISSING')"
done

cat << 'EOF'

==> Add these to ~/.bashrc if the installers did not:
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

==> USB forwarding is driven ENTIRELY FROM WINDOWS, not from here.
    `usbipd` is a Windows command. Running it inside WSL hits an unrelated
    Linux daemon of the same name and prints a kernel-version warning.

    Exit WSL, open an ADMIN PowerShell, and run:
      usbipd list                          # find the BUSID (Espressif = VID 303a)
      usbipd bind   --busid <BUSID>        # once per device; persists reboots
      usbipd attach --wsl --busid <BUSID>  # re-run after each replug/reboot

==> Then back in WSL:
    ls -l /dev/ttyACM*                                 # expect /dev/ttyACM0
    bun run --cwd home-assistant-voice-firmware flash  # build + USB flash + logs
    bun run --cwd home-assistant-voice-firmware logs   # serial logs only

==> Performance note:
    Working out of /mnt/d/... is slow (Windows filesystem over 9p) and will make
    node_modules and ESP-IDF builds crawl. Clone into the Linux filesystem:
      git clone https://github.com/ffMathy/hey-jarvis.git ~/repos/hey-jarvis
EOF
