#!/bin/bash
# Build an installable APK of the watch app.
#
# This is the release variant: the JavaScript bundle is embedded, so the APK runs
# on its own with no Metro server. It is what the `Wear APK` workflow uploads.
#
# It is signed with the debug keystore the Expo template generates into
# `android/app`, the same well-known key on every machine — so builds from CI and
# from a laptop install over each other, which the old Gradle prototype's
# per-machine debug key did not. It is not fit for distribution.
#
# Needs a JDK 17+, the Android SDK (`ANDROID_HOME`) and Node for the Gradle
# plugin's bundling step.
set -euo pipefail

cd "$(dirname "$0")/.."

# Watches are arm64, like phones — a Pixel Watch is a Snapdragon W5. Every extra
# ABI compiles Skia and the React Native core again, which is twenty minutes a
# piece, so only the one the watch runs is built.
architectures='arm64-v8a'

output_dir='../dist/wear-apk'

# `android/` is generated rather than committed; `--no-install` because the
# workspace install has already happened, and a second one would be npm's.
bunx expo prebuild --platform android --no-install

# No daemon: a build leaves one behind holding a few gigabytes otherwise.
(cd android && ./gradlew app:assembleRelease --no-daemon -PreactNativeArchitectures="$architectures")

mkdir -p "$output_dir"
cp android/app/build/outputs/apk/release/app-release.apk "$output_dir/jarvis-wear.apk"
echo "APK written to dist/wear-apk/jarvis-wear.apk"
