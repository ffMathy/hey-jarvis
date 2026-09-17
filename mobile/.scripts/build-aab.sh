#!/bin/bash
# Build a signed Android App Bundle, which is what Google Play takes.
#
# A bundle rather than an APK because Play has not accepted APKs for new apps since 2021: an .aab
# carries every ABI and density, and Play builds the APK each phone actually downloads. That is also
# why this does not restrict the architectures the way `build-apk.sh` does — a bundle that only
# contains arm64 is a bundle that will not install on anything else.
#
# Signed with the upload key, not the debug key. See `mobile/release-signing.ts` for how the two
# live side by side, and `docs/play-store.md` for where the key comes from.
#
# Needs these in the environment. `bunx turbo build:aab --filter=mobile` resolves them from
# 1Password through `mobile/op.env`; nothing here reads a file or prints a value.
#
#   HEY_JARVIS_ANDROID_KEYSTORE_BASE64    the upload keystore, base64, one line
#   HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD  the keystore's own password
#   HEY_JARVIS_ANDROID_KEY_ALIAS          which key inside it to sign with
#   HEY_JARVIS_ANDROID_KEY_PASSWORD       that key's password
#
# Optional:
#   JARVIS_ANDROID_VERSION_CODE           the build number Play orders uploads by; CI passes the
#                                         run number, and Play refuses a repeat. Defaults to 1.
#
# Also needs a JDK 17+, the Android SDK (`ANDROID_HOME`) and Node for the Gradle plugin's bundling
# step, exactly as `build-apk.sh` does.
set -euo pipefail

cd "$(dirname "$0")/.."

output_dir='../dist/mobile-aab'

# Every one of them, named, before anything slow happens. A build that gets forty minutes in and
# then fails on a missing password is a build nobody wants to run twice.
missing=()
for name in \
  HEY_JARVIS_ANDROID_KEYSTORE_BASE64 \
  HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD \
  HEY_JARVIS_ANDROID_KEY_ALIAS \
  HEY_JARVIS_ANDROID_KEY_PASSWORD; do
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ Missing: ${missing[*]}" >&2
  echo "   These come from 1Password via mobile/op.env — see docs/play-store.md." >&2
  exit 1
fi

# Somewhere private for the keystore, removed however this script ends. A keystore is a file, and
# Gradle will only take it as one, so it has to exist on disk for the length of the build.
keystore_dir="$(mktemp -d)"
chmod 700 "$keystore_dir"
trap 'rm -rf "$keystore_dir"' EXIT
keystore="$keystore_dir/upload.jks"
printf '%s' "$HEY_JARVIS_ANDROID_KEYSTORE_BASE64" | base64 -d > "$keystore"
chmod 600 "$keystore"

# Confirm it decoded into something Java will open, and say so without saying anything about what is
# inside it. Base64 that arrived wrapped or truncated fails here rather than eighty lines into a
# Gradle stack trace about a corrupt stream.
if ! keytool -list -keystore "$keystore" -storepass "$HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD" > /dev/null 2>&1; then
  echo "❌ The keystore did not open. Either the base64 is not a keystore, or the password is wrong." >&2
  echo "   Re-run the base64 step in docs/play-store.md; note it must be one line with no wrapping." >&2
  exit 1
fi

# Handed over as environment variables rather than as `-P` arguments, which would put the passwords
# in the process list for anything else on the machine to read. Gradle maps this prefix onto project
# properties itself; `release-signing.ts` is what picks them up.
export ORG_GRADLE_PROJECT_JARVIS_UPLOAD_STORE_FILE="$keystore"
export ORG_GRADLE_PROJECT_JARVIS_UPLOAD_STORE_PASSWORD="$HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD"
export ORG_GRADLE_PROJECT_JARVIS_UPLOAD_KEY_ALIAS="$HEY_JARVIS_ANDROID_KEY_ALIAS"
export ORG_GRADLE_PROJECT_JARVIS_UPLOAD_KEY_PASSWORD="$HEY_JARVIS_ANDROID_KEY_PASSWORD"

# `android/` is generated rather than committed; `--no-install` because the workspace install has
# already happened, and a second one would be npm's.
bunx expo prebuild --platform android --no-install

# No daemon: a build leaves one behind holding a few gigabytes otherwise.
(cd android && ./gradlew app:bundleRelease --no-daemon)

mkdir -p "$output_dir"
cp android/app/build/outputs/bundle/release/app-release.aab "$output_dir/jarvis.aab"
echo "Bundle written to dist/mobile-aab/jarvis.aab (versionCode ${JARVIS_ANDROID_VERSION_CODE:-1})"
