#!/bin/bash
# Put React Native Skia's prebuilt libraries where its Gradle build expects them.
#
# Skia does this in a postinstall, and postinstalls never run here
# (`ignoreScripts = true` in bunfig.toml). Nothing is downloaded: it only copies
# the native libraries out of the `react-native-skia-android` package that
# `bun install` already fetched and locked, into Skia's own `libs/`. Without it
# the build dies in CMake three minutes in with "Skia prebuilt binaries not
# found", which is exactly how the watch app's first CI build failed.
#
# Run from `watch/` rather than the workspace root on purpose. Bun's isolated
# linker keys its store by a package's whole dependency closure, so this app and
# the phone app resolve *different copies* of `@shopify/react-native-skia` — and
# each copy needs its own libraries put in place. `bunx` here picks this one.
#
# There is no `setup-skia-web` step, unlike the phone app's: a watch has no
# browser to draw CanvasKit in.
set -euo pipefail

cd "$(dirname "$0")/.."

bunx install-skia
