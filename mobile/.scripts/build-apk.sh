#!/bin/bash
# Build an installable Android APK of the app.
#
# This is the release variant: the JavaScript bundle is embedded, so the APK runs
# on its own with no Metro server and no development client. It is what the
# `Mobile APK` workflow uploads. (`verify-assistant-on-emulator.sh` builds its
# own, through `expo run:android`, because an emulator needs x86_64 rather than
# the arm64 built here.)
#
# It is signed with the debug keystore the Expo template generates into
# `android/app`, which is the same well-known key on every machine. That keeps
# builds from CI and from a laptop installable over each other, and it is fine
# for side-loading onto your own phone. It is not fit for distribution: anyone
# holding that key can sign an "update" Android will accept.
#
# Needs a JDK 17+, the Android SDK (`ANDROID_HOME`) and Node for the Gradle
# plugin's bundling step. Gradle fetches the platform, build tools and NDK it
# wants on the first run, provided the SDK licences have been accepted.
set -euo pipefail

cd "$(dirname "$0")/.."

# Phones are arm64. Every extra ABI compiles the native modules again — all four
# took twenty minutes on an 8-core machine — so only the one a phone runs is
# built. An x86_64 emulator needs `reactNativeArchitectures=x86_64` instead.
architectures='arm64-v8a'

output_dir='../dist/mobile-apk'

# `android/` is generated rather than committed; `--no-install` because the
# workspace install has already happened, and a second one would be npm's.
bunx expo prebuild --platform android --no-install

# No daemon: a build leaves one behind holding a few gigabytes otherwise, which
# is wasted on a CI runner and is what starved the emulator locally.
(cd android && ./gradlew app:assembleRelease --no-daemon -PreactNativeArchitectures="$architectures")

mkdir -p "$output_dir"
cp android/app/build/outputs/apk/release/app-release.apk "$output_dir/jarvis.apk"
echo "APK written to dist/mobile-apk/jarvis.apk"
