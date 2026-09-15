#!/bin/bash
# Put React Native Skia's prebuilt pieces where its build expects them.
#
# Skia normally does both of these in a postinstall, and postinstalls never run
# here (`ignoreScripts = true` in bunfig.toml). Nothing is downloaded: both steps
# only copy files out of packages `bun install` already fetched and locked.
#
# - `install-skia` copies the native Skia libraries out of the
#   `react-native-skia-android` / `-apple-*` packages into Skia's own `libs/`,
#   which its Gradle build links against. Without it an Android build fails in
#   CMake, long after it started.
# - `setup-skia-web` copies `canvaskit.wasm` into `public/`, which the web export
#   serves from its root. Without it the hologram cannot draw in a browser.
set -euo pipefail

cd "$(dirname "$0")/.."

bunx install-skia
bunx setup-skia-web public
