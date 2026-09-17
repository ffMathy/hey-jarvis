#!/bin/bash
# The watch app's signed Android App Bundle, for Google Play.
#
# Uploaded into the *same* Play release as the phone's, which is the only way Play will deliver it
# to a paired watch: same package name, same upload key, a version code of its own. See
# `.scripts/build-android-bundle.sh` and `docs/play-store.md`.
set -euo pipefail
exec bash "$(dirname "$0")/../../.scripts/build-android-bundle.sh" watch watch-aab
