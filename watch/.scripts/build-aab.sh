#!/bin/bash
# The watch app's signed Android App Bundle, for Google Play.
#
# Uploaded as its own Play release, on the Wear OS track beside the phone's — a mobile track has
# refused a watch artifact since March 2023. What makes Play deliver it to a paired watch is that it
# shares the phone's package name and upload key and has a version code of its own. See
# `.scripts/build-android-bundle.sh` and `docs/play-store.md`.
set -euo pipefail
exec bash "$(dirname "$0")/../../.scripts/build-android-bundle.sh" watch watch-aab
