#!/usr/bin/env bash
set -euo pipefail
# Build (compile) firmware; substitutions added by invoke-esphome.sh
../.scripts/run-with-env.sh ./op.env bash ./.scripts/invoke-esphome.sh compile
