#!/usr/bin/env bash
set -euo pipefail
# Upload firmware; substitutions added by invoke-esphome.sh
../.scripts/run-with-env.sh ./op.env bash ./.scripts/invoke-esphome.sh upload
