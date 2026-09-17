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
KEYCODE_HOME=3
KEYCODE_WAKEUP=224
KEYCODE_ASSIST=219
# The first boot of a freshly created AVD does its one-off setup and dex
# optimisation, and on a 16 GB machine with a Gradle daemon alive it took just
# over five minutes. Later boots of the same AVD are far quicker.
BOOT_TIMEOUT_SECONDS="${JARVIS_BOOT_TIMEOUT_SECONDS:-600}"
# A cold start of the release build, splash screen included, is about three
# seconds on an x86_64 emulator under KVM. The deadline is generous so a slow
# machine does not read as a broken assistant.
SUMMON_TIMEOUT_SECONDS=30
# See the role grant below for why this is minutes rather than seconds.
ROLE_GRANT_TIMEOUT_SECONDS=420
# And for why a settled foreground can take minutes on a fresh emulator.
FOREGROUND_SETTLE_TIMEOUT_SECONDS=300

fail() {
  echo "✗ $1" >&2
  exit 1
}

# The activity that currently has focus. API 29+ calls it topResumedActivity;
# older releases only print mResumedActivity. `|| true` because an empty answer
# — the display asleep, say — is a result to report, not a reason for `set -e`
# to end the script with no message.
top_resumed_activity() {
  adb shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' | tr -d '\r' || true
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
forced_display_on=false

# Whatever this script changed is put back however it ends, not only when it
# reaches the end. An emulator it booted and left running is picked up by the
# next run as "the device already attached", with the previous run's app and
# role still on it; and a device that was already attached would otherwise keep
# its display forced on and its lock screen disabled after any failure, which
# nothing announces and nobody thinks to look for.
#
# The display is restored before the emulator is killed, because a dead emulator
# takes no adb shell.
restore_device() {
  if [ "$forced_display_on" = true ]; then
    adb shell svc power stayon false >/dev/null 2>&1 || true
    adb shell locksettings set-disabled false >/dev/null 2>&1 || true
  fi

  if [ "$started_emulator" = true ]; then
    echo '→ Shutting the emulator down'
    adb emu kill >/dev/null 2>&1 || true
  fi
}
trap restore_device EXIT

if [ -z "$(adb devices | awk 'NR>1 && $2=="device" {print $1}')" ]; then
  echo "→ Booting $AVD_NAME (headless)"
  emulator -avd "$AVD_NAME" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &
  started_emulator=true

  # Bounded, because an emulator that dies on start — no KVM access, not enough
  # memory — never appears, and an unbounded wait would hang here in silence.
  timeout "$BOOT_TIMEOUT_SECONDS" adb wait-for-device || fail "No emulator appeared within ${BOOT_TIMEOUT_SECONDS}s.
  Run 'emulator -avd $AVD_NAME' in the foreground to see why it did not start."
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

echo '→ Building and installing the release build (this is the slow part)'
# The release variant, with no bundler. The default debug variant is a
# development build: `expo run:android` then starts Metro and stays attached to
# it, so this line never returns and the script never reaches the button. It
# would also not be testing Jarvis — a development build with no Metro behind it
# opens the dev launcher, not the app. The release build embeds the JavaScript
# bundle, is signed with the debug keystore, and leaves no Metro process behind.
bun run --cwd mobile android --variant release --no-bundler

# The build leaves a Gradle daemon and a Kotlin compile daemon behind, idle and
# holding close to 5 GB between them. The emulator needs that memory more: with
# them alive on a 16 GB machine, the freshly booted emulator's SystemUI stalled
# into an ANR, was restarted, and put the lock screen back over everything — so
# no key press could reach the assistant. Stopping Gradle stops both.
(cd mobile/android && ./gradlew --stop >/dev/null 2>&1) || true

# --- Make Jarvis the assistant ---------------------------------------------

echo '→ Granting the assistant role'
# The role cannot be requested from inside the app — Android declares it not
# requestable — so on a device a human picks it in Settings. From the shell of a
# userdebug image it can be granted directly, which is what makes this scriptable.
#
# Retried against a deadline, because `sys.boot_completed` does not mean the
# role controller is ready. On a freshly created API 34 AVD, PermissionController
# spends its first few minutes re-evaluating every default role holder, and
# system_server gives up on each `onAddRoleHolder` call after five seconds with
# `java.util.concurrent.TimeoutException` — for close to three minutes after
# boot, in the run that measured it. A timed-out request can still land later,
# so success is judged by asking who holds the role, not by the exit status.
build_type="$(adb shell getprop ro.build.type | tr -d '\r')"
[ "$build_type" != 'user' ] || fail "This image is a 'user' build, whose shell cannot grant the assistant
  role. Every google_play image is one; use a google_apis or default image."
deadline=$((SECONDS + ROLE_GRANT_TIMEOUT_SECONDS))
holds_role() {
  [ "$(adb shell cmd role get-role-holders android.app.role.ASSISTANT | tr -d '\r')" = "$PACKAGE" ]
}
until holds_role; do
  grant_output="$(adb shell cmd role add-role-holder android.app.role.ASSISTANT "$PACKAGE" 2>&1 | tr -d '\r' || true)"
  holds_role && break
  [ "$SECONDS" -lt "$deadline" ] || fail "The shell could not grant the assistant role within ${ROLE_GRANT_TIMEOUT_SECONDS}s:
  ${grant_output:-no output}"
  echo "  not granted yet (${grant_output:-no output}); retrying in 10s"
  sleep 10
done

role_holder="$(adb shell cmd role get-role-holders android.app.role.ASSISTANT | tr -d '\r')"
case "$role_holder" in
  *"$PACKAGE"*) echo "  role holder: $role_holder" ;;
  *) fail "Jarvis did not take the assistant role (holder: '${role_holder:-none}')." ;;
esac

# The setting is written by the system when it reacts to the role changing, so it
# is given a few seconds to catch up before a mismatch counts.
deadline=$((SECONDS + 15))
active_service="$(adb shell settings get secure voice_interaction_service | tr -d '\r')"
while [ "$active_service" != "$VOICE_INTERACTION_SERVICE" ] && [ "$SECONDS" -lt "$deadline" ]; do
  sleep 1
  active_service="$(adb shell settings get secure voice_interaction_service | tr -d '\r')"
done
[ "$active_service" = "$VOICE_INTERACTION_SERVICE" ] || fail "The system is not using Jarvis's
  VoiceInteractionService — it reported '${active_service}'.
  An empty value means the manifest qualified only for the cut-down assist-intent path;
  check 'adb logcat -s VoiceInteractionServiceInfo' for the parse error that names the cause."
echo "  voice interaction service: $active_service"

# --- Press the button ------------------------------------------------------

echo '→ Putting something other than Jarvis in front'
# Installing the app also launches it, so at this point Jarvis is very likely
# already the resumed activity — and an assertion that it is resumed after the
# button would pass with the button doing nothing at all. So first the screen is
# woken and kept on (a headless emulator sleeps on its own timeout, and a
# sleeping display takes no key events, including KEYCODE_ASSIST), the lock
# screen turned off, and the launcher brought to the front. The check below that
# Jarvis is NOT resumed is what makes the later check that it IS mean something.
#
# `wm dismiss-keyguard` alone is not enough: on a freshly created API 34 AVD the
# keyguard came straight back a second after Home, and every activity went to
# sleep with it. Disabling the lock screen outright is what holds. It only works
# on a device without a PIN, which an emulator is; on one with a PIN it refuses,
# and the check below says so.
#
# The whole sequence is retried until the foreground holds still, because a
# freshly booted emulator on a busy machine is not settled yet. What was actually
# seen: SystemUI is slow enough during first boot to raise an "Application Not
# Responding" dialog, and although SystemUI recovers, the dialog stays in focus
# indefinitely waiting for an answer. Key events sent into it take its "close
# app" path, SystemUI is killed and restarted, and a restarted SystemUI puts the
# keyguard back up over everything. So a leftover ANR dialog is cleared first,
# on purpose and before any key is sent, and SystemUI is given time to come back.
deadline=$((SECONDS + FOREGROUND_SETTLE_TIMEOUT_SECONDS))
while :; do
  focus="$(adb shell dumpsys window | grep -m1 -E 'mCurrentFocus=' | tr -d '\r' || true)"
  case "$focus" in
    *'Application Not Responding'*)
      echo "  clearing a leftover ANR dialog (${focus#*: }) and letting SystemUI restart"
      adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null
      sleep 15
      ;;
  esac

  adb shell input keyevent "$KEYCODE_WAKEUP"
  forced_display_on=true
  adb shell svc power stayon true
  adb shell locksettings set-disabled true >/dev/null || true
  adb shell wm dismiss-keyguard
  adb shell input keyevent "$KEYCODE_HOME"
  sleep 3

  # Held for five seconds with nothing changing — the SystemUI restart above
  # took the foreground away about two seconds after Home.
  before="$(top_resumed_activity)"
  settled=''
  if [ -n "$before" ] && case "$before" in *"$PACKAGE"*) false ;; *) true ;; esac; then
    sleep 5
    settled="$(top_resumed_activity)"
    [ "$settled" != "$before" ] || break
  fi

  focus="$(adb shell dumpsys window | grep -m1 -E 'mCurrentFocus=' | tr -d '\r' || true)"
  [ "$SECONDS" -lt "$deadline" ] || fail "The device did not settle with something other than Jarvis in front within
  ${FOREGROUND_SETTLE_TIMEOUT_SECONDS}s. Last resumed: '${settled:-${before:-nothing}}'; focus: '${focus## }'.
  Nothing resumed means the display is asleep or locked; unlock the device and re-run."
  echo "  not settled yet (resumed: '${settled:-${before:-nothing}}'); retrying in 10s"
  sleep 10
done
echo "  resumed: $before"

echo '→ Pressing the assistant button (KEYCODE_ASSIST)'
# Deliberately the key event rather than `am start -a android.intent.action.ASSIST`.
# The intent takes the activity path, which would pass even if the session were
# broken; only the key event goes through VoiceInteractionSession.onShow, which is
# the thing under test.
adb logcat -c
adb shell input keyevent "$KEYCODE_ASSIST"

resumed=''
deadline=$((SECONDS + SUMMON_TIMEOUT_SECONDS))
until case "$resumed" in *"$PACKAGE"*) true ;; *) false ;; esac; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "  resumed: ${resumed:-nothing}" >&2
    adb logcat -d -s JarvisAssistant >&2 || true
    fail "The assistant button did not bring Jarvis to the front within ${SUMMON_TIMEOUT_SECONDS}s.
  The session's own log is above; the fallback path in JarvisVoiceInteractionSession logs a
  warning when startAssistantActivity is refused."
  fi
  sleep 1
  resumed="$(top_resumed_activity)"
done
echo "  resumed: $resumed"

# Coming to the front is not quite the claim. The session tries
# `startAssistantActivity` first and falls back to a plain `startActivity`, and
# the fallback also brings Jarvis to the front — over the user's app instead of
# in the assistant's own layer, which is the behaviour the session exists to
# avoid. Only `startAssistantActivity` puts the activity in a task of type
# `assistant`, so that is what separates the two. The task is looked up by the
# id on the resumed activity — ` t13}` — rather than by package, so an assistant
# task left over from an earlier run cannot stand in for this one.
task_id="$(printf '%s' "$resumed" | sed -nE 's/.* t([0-9]+)\}.*/\1/p')"
[ -n "$task_id" ] || fail "Could not read a task id out of '$resumed'."
assistant_task="$(adb shell dumpsys activity activities | grep -m1 -E "Task\{[0-9a-f]+ #${task_id} type=assistant " | tr -d '\r' || true)"
[ -n "$assistant_task" ] || fail "Jarvis came to the front, but not in an assistant task — the session fell
  back to a plain startActivity. 'adb logcat -s JarvisAssistant' has the exception it caught."
echo "  task: ${assistant_task#"${assistant_task%%[![:space:]]*}"}"

launch="$(adb logcat -d -s ActivityTaskManager | grep -m1 -F 'heyjarvis://assist' | tr -d '\r' || true)"
[ -n "$launch" ] || fail "Jarvis is in front in an assistant task, but the system logged no start for
  heyjarvis://assist — so the app would not know it was summoned and would not start listening."
echo "  launch: $launch"

echo
echo "✓ The assistant button opened Jarvis, through the voice interaction session."
