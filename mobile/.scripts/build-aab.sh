#!/bin/bash
# The phone app's signed Android App Bundle, for Google Play.
#
# One line, because the watch builds the same way and the signing must be identical between them:
# see `.scripts/build-android-bundle.sh` for what this actually does and what it needs.
set -euo pipefail
exec bash "$(dirname "$0")/../../.scripts/build-android-bundle.sh" mobile mobile-aab
