#!/bin/bash
# Prove that the assistant button opens Jarvis.
#
# This is the one claim in `mobile/` that no offline test can settle. The Kotlin
# compiles, the manifest merges, and the deep-link contract is asserted — but
# whether holding the assistant button actually reaches
# `JarvisVoiceInteractionSession.onShow` and brings the app up is a question only
# a running Android can answer.
#
# It cannot run in CI or in an agent sandbox: both want the Android SDK, which is
# served only from dl.google.com, and an emulator wants hardware virtualisation.
# On a developer machine — including WSL2 with nested virtualisation enabled —
# both are available, so this script encodes the check rather than leaving it as
# a paragraph nobody repeats the same way twice.
#
# Usage:
#   ./mobile/.scripts/verify-assistant-on-emulator.sh
#
# Every prerequisite is checked before anything is installed or started, because
# a half-finished run leaves an emulator booted and an app side-loaded, and the
# next person has to work out which step failed.
set -euo pipefail

PACKAGE='com.ffmathy.heyjarvis'
VOICE_INTERACTION_SERVICE="${PACKAGE}/expo.modules.jarvisassistant.JarvisVoiceInteractionService"
AVD_NAME="${JARVIS_AVD:-jarvis-assistant-check}"
KEYCODE_ASSIST=219
BOOT_TIMEOUT_SECONDS=300

fail() {
  echo "✗ $1" >&2
  exit 1
}

# --- Preflight -------------------------------------------------------------

echo '→ Checking prerequisites'

[ -e /dev/kvm ] || fail "No /dev/kvm. On WSL2, add 'nestedVirtualization=true' under [wsl2] in
  %USERPROFILE%\\.wslconfig, then 'wsl --shutdown' and reopen. On a Linux host, enable
  virtualisation in the firmware. Without it the emulator either refuses an x86 image or
  falls back to an ARM image under full emulation, which is too slow to be a test."

[ -r /dev/kvm ] && [ -w /dev/kvm ] || fail "/dev/kvm exists but is not readable and writable by $(id -un).
  Add yourself to the kvm group ('sudo usermod -aG kvm $(id -un)') and start a new shell."

command -v adb >/dev/null || fail "adb is not on PATH. Install the Android SDK platform-tools and add
  \$ANDROID_HOME/platform-tools to PATH."

command -v emulator >/dev/null || fail "emulator is not on PATH. Install it with
  'sdkmanager emulator' and add \$ANDROID_HOME/emulator to PATH."

emulator -list-avds | grep -qx "$AVD_NAME" || fail "No AVD called '$AVD_NAME'. Create one, for example:
  sdkmanager 'system-images;android-34;google_apis;x86_64'
  avdmanager create avd -n '$AVD_NAME' -k 'system-images;android-34;google_apis;x86_64'
  Use a google_apis or default image, NOT google_play: the Play images are user builds, and
  the shell there may not hold the permission needed to grant the assistant role below.
  Override the name with JARVIS_AVD=<name>."

echo '  all present'

# --- Boot ------------------------------------------------------------------

started_emulator=false
if [ -z "$(adb devices | awk 'NR>1 && $2=="device" {print $1}')" ]; then
  echo "→ Booting $AVD_NAME (headless)"
  emulator -avd "$AVD_NAME" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &
  started_emulator=true

  adb wait-for-device
  # `wait-for-device` returns as soon as adb can talk to it, which is long before
  # the framework is up. sys.boot_completed is the part that matters.
  deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = '1' ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "Emulator did not finish booting within ${BOOT_TIMEOUT_SECONDS}s."
    sleep 3
  done
  echo '  booted'
else
  echo '→ Using the device already attached'
fi

# --- Build and install -----------------------------------------------------

echo '→ Building and installing the app (this is the slow part)'
bun run --cwd mobile android

# --- Make Jarvis the assistant ---------------------------------------------

echo '→ Granting the assistant role'
# The role cannot be requested from inside the app — Android declares it not
# requestable — so on a device a human picks it in Settings. From the shell of a
# userdebug image it can be granted directly, which is what makes this scriptable.
adb shell cmd role add-role-holder android.app.role.ASSISTANT "$PACKAGE"

role_holder="$(adb shell cmd role get-role-holders android.app.role.ASSISTANT | tr -d '\r')"
case "$role_holder" in
  *"$PACKAGE"*) echo "  role holder: $role_holder" ;;
  *) fail "Jarvis did not take the assistant role (holder: '${role_holder:-none}')." ;;
esac

active_service="$(adb shell settings get secure voice_interaction_service | tr -d '\r')"
[ "$active_service" = "$VOICE_INTERACTION_SERVICE" ] || fail "The system is not using Jarvis's
  VoiceInteractionService — it reported '${active_service}'.
  An empty value means the manifest qualified only for the cut-down assist-intent path;
  check 'adb logcat -s VoiceInteractionServiceInfo' for the parse error that names the cause."
echo "  voice interaction service: $active_service"

# --- Press the button ------------------------------------------------------

echo '→ Pressing the assistant button (KEYCODE_ASSIST)'
# Deliberately the key event rather than `am start -a android.intent.action.ASSIST`.
# The intent takes the activity path, which would pass even if the session were
# broken; only the key event goes through VoiceInteractionSession.onShow, which is
# the thing under test.
adb shell input keyevent "$KEYCODE_ASSIST"
sleep 4

resumed="$(adb shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' | tr -d '\r')"
case "$resumed" in
  *"$PACKAGE"*)
    echo "  resumed: $resumed"
    echo
    echo "✓ The assistant button opened Jarvis."
    ;;
  *)
    echo "  resumed: ${resumed:-nothing}" >&2
    fail "The assistant button did not bring Jarvis to the front.
  'adb logcat -s JarvisAssistant' shows what the session logged; the fallback path in
  JarvisVoiceInteractionSession logs a warning when startAssistantActivity is refused."
    ;;
esac

if [ "$started_emulator" = true ]; then
  echo '→ Shutting the emulator down'
  adb emu kill >/dev/null 2>&1 || true
fi
