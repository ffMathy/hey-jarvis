#!/bin/bash
# Build the Wear OS app's APK.
#
# Needs a JDK 17+ and the Android SDK, found through ANDROID_HOME or a
# `local.properties` beside this project. Gradle fetches the platform and build
# tools it wants on the first run, provided the SDK licences have been accepted.
set -euo pipefail

cd "$(dirname "$0")/.."

output_dir='../dist/wear-apk'

# No daemon: a build leaves one behind holding gigabytes otherwise, which is
# wasted on a CI runner and starves an emulator locally.
./gradlew app:assembleRelease --no-daemon

mkdir -p "$output_dir"
cp app/build/outputs/apk/release/app-release.apk "$output_dir/jarvis-wear.apk"
echo "APK written to dist/wear-apk/jarvis-wear.apk"
