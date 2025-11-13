#!/usr/bin/env bash
set -euo pipefail

# Use OTA upload instead of USB
# ESPHome will automatically discover the device on the network
../.scripts/run-with-env.sh ./op.env bash ./.scripts/invoke-esphome.sh run