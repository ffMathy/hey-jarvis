#!/bin/bash
# Put React Native Skia's prebuilt libraries where its Gradle build expects them.
#
# Skia does this in a postinstall, and postinstalls never run here
# (`ignoreScripts = true` in bunfig.toml). Nothing is downloaded: `install-skia`
# only copies the native libraries out of the `react-native-skia-android` and
# `-apple-*` packages that `bun install` already fetched and locked, into Skia's
# own `libs/`. Without it an Android build dies in CMake three minutes in with
# "Skia prebuilt binaries not found", which is exactly how the watch app's first
# CI build failed.
#
# **This lives at the workspace root and runs once, rather than once per app —
# and that is the fix, not tidying.** `install-skia` writes into the *installed
# package's* own `libs/`, and it clears each directory before copying into it:
#
#   fs.rmSync(path.join(libsDir, "ios"), { recursive: true, force: true });
#   fs.mkdirSync(path.join(libsDir, "ios"), { recursive: true });
#   copySync(iosPackage + "/libs/*.xcframework", path.join(libsDir, "ios"), ...);
#
# The phone and the watch resolve the *same physical copy* of
# `@shopify/react-native-skia`, so while each app ran this as its own
# `initialize` — with nothing in the task graph ordering the two — Turbo ran them
# in parallel and they raced on that one directory. One process deleted
# `libs/ios` while the other was still copying into it, and the loser died on the
# file it had just written:
#
#   Error: ENOENT: no such file or directory, chmod
#   '.../libs/ios/libskia.xcframework/ios-arm64_arm64e/libskia.a'
#
# That is how the `deploy` job of releases 2.2.0 and 2.2.1 failed: `mobile` lost
# the coin flip in the first, `watch` in the second. A single root task is the
# whole mutex — Turbo runs `//#install-skia` once and both apps wait on it — and
# it fixes every entry point at once, since `turbo build`, `turbo deploy`,
# `build:aab` and `build:apk` all reach the apps' `initialize` the same way.
#
# It still walks the apps rather than assuming a single copy. Bun's isolated
# linker keys its store by a package's whole dependency closure, so if the two
# apps' closures ever diverge they get a copy each, and each copy needs its own
# libraries put in place. Identical closures collapse to one directory — the case
# today — and that copy is done once.
#
# `setup-skia-web` is not here: it copies `canvaskit.wasm` into an app's own
# `public/`, which is per-app and races nothing, so it stays in `mobile`'s
# `initialize`.
set -euo pipefail

cd "$(dirname "$0")/.."

# Newline-delimited so a path containing spaces still compares as one entry.
installed=""

for app in mobile watch; do
  # `bunx install-skia` copies into whichever copy of the package the *current
  # directory* resolves to, so resolve from the app and then run from the app.
  copy="$(cd "$app" && node -p "require('path').dirname(require.resolve('@shopify/react-native-skia/package.json'))")"

  if printf '%s\n' "$installed" | grep -Fxq -- "$copy"; then
    echo "-- ${app}: shares its Skia copy with an app already done, nothing to do"
    continue
  fi

  echo "-- ${app}: installing Skia libraries into ${copy}"
  (cd "$app" && bunx install-skia)

  installed="$(printf '%s\n%s' "$installed" "$copy")"
done
