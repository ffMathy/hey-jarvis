#!/bin/bash
# Build the mobile app's JavaScript bundle.
#
# This deliberately stops short of producing an APK. Assembling one needs the
# Android SDK, a JDK and the NDK, none of which exist in the container CI runs
# in, and installing them would add minutes to every push for an artifact
# nothing downstream consumes — the installable build is produced by EAS from
# `eas.json`.
#
# What this does catch is everything a bundle can: an import that does not
# resolve, a native module missing from the dependency tree, a syntax error in a
# file no test imports. That is the half of a mobile build that actually breaks.
set -euo pipefail

cd "$(dirname "$0")/.."

exec bunx expo export --platform android --output-dir ../dist/mobile --clear
