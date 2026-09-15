#!/bin/bash
# Look at the Jarvis hologram on an emulator, and measure that it pulses with his voice.
#
# The hologram's drawing is covered offline (`src/hologram-drawing.spec.ts`
# renders it headlessly), but whether it animates in the app, on the UI thread,
# through Reanimated and native Skia, is something only a running Android shows.
# And an emulator has no ElevenLabs session to pulse to — so this builds the app
# with a recorded voice in place of the live one (see `metro.config.js` and
# `tests/hologram-preview/`), replaying the two readings the SDK's web build gives:
# RMS volume and a 1024-bin spectrum every 40 ms.
#
# It then records the screen and checks two things:
#   1. the hologram keeps moving while Jarvis is silent;
#   2. its brightness follows the replayed voice — by correlation, with a
#      reversed-voice control — and is brighter while he speaks than while he
#      does not. Thresholds live in `tests/hologram-preview/measure-pulse.ts`.
#
# Screenshots, the screen recording and the measurements are left in
# mobile/tests/hologram-preview/evidence/ — not under dist/, which every web
# export (and so every `turbo e2e`) deletes.
#
# Usage:
#   ./mobile/.scripts/verify-hologram-on-emulator.sh
#
# Needs what verify-assistant-on-emulator.sh needs (KVM, the Android SDK), plus
# espeak-ng and ffmpeg, and its own small AVD, jarvis-hologram-check (or
# JARVIS_AVD). The preflight prints how to create it.
set -euo pipefail

cd "$(dirname "$0")/../.."

PACKAGE='com.ffmathy.heyjarvis'
# A 540x960 screen rather than the Pixel 6's 1080x2400. The emulator draws with
# a software GPU, which drew the Pixel 6 screen at under two frames a second with
# the app answering "not responding"; at a quarter of the pixels it manages about
# 2.7, which is what VOICE_SLOWDOWN below was chosen for.
AVD_NAME="${JARVIS_AVD:-jarvis-hologram-check}"
BOOT_TIMEOUT_SECONDS="${JARVIS_BOOT_TIMEOUT_SECONDS:-600}"
PREVIEW_DIR='mobile/tests/hologram-preview'
OUTPUT_DIR="$PREVIEW_DIR/evidence"
# Must match SILENCE_MS in tests/hologram-preview/jarvis-voice.replay.ts.
SILENCE_MS=6000
# The voice is replayed this many times slower than it was spoken. An emulator
# draws with a software GPU, and measured at 2–3 frames a second for the hologram
# (a phone draws on its GPU at full rate): far too slow to follow syllables four
# times a second, which would make "does it follow the voice" unanswerable here
# however correct the app is. Slowed down, each reading lasts 320 ms, and the
# syllables come slowly enough to see. Nothing else changes — the folding, the
# easing (in real time) and the drawing are the app's own, and the thresholds in
# measure-pulse.ts are the same as for a real-time run.
VOICE_SLOWDOWN=8
# A little over one and a half loops of silence plus the slowed line, which is as
# long as screenrecord records.
RECORD_SECONDS=180
# The bundle Gradle generates for a release build. It is built with the replayed
# voice here, and Gradle does not know that — left behind, the next ordinary
# release build would reuse it. So it is removed before and after.
GENERATED_BUNDLE_DIR='mobile/android/app/build/generated/assets/react'

fail() {
  echo "✗ $1" >&2
  exit 1
}

echo '→ Checking prerequisites'
[ -r /dev/kvm ] && [ -w /dev/kvm ] || fail "/dev/kvm is missing or not usable by $(id -un); see verify-assistant-on-emulator.sh."
for tool in adb emulator espeak-ng ffmpeg bun; do
  command -v "$tool" >/dev/null || fail "$tool is not on PATH."
done
emulator -list-avds | grep -qx "$AVD_NAME" || fail "No AVD called '$AVD_NAME'. Create the one the documented run used:
    avdmanager create avd -n '$AVD_NAME' -k 'system-images;android-34;google_apis;x86_64' -d pixel_6
    sed -i 's/^hw.lcd.width=.*/hw.lcd.width=540/; s/^hw.lcd.height=.*/hw.lcd.height=960/; s/^hw.lcd.density=.*/hw.lcd.density=240/' ~/.android/avd/$AVD_NAME.avd/config.ini
  or name another with JARVIS_AVD."
echo '  all present'

started_emulator=false
cleanup() {
  rm -rf "$GENERATED_BUNDLE_DIR"
  if [ "$started_emulator" = true ]; then
    echo '→ Shutting the emulator down'
    adb emu kill >/dev/null 2>&1 || true
  else
    adb shell svc power stayon false >/dev/null 2>&1 || true
    adb shell locksettings set-disabled false >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- The voice --------------------------------------------------------------

echo '→ Recording a voice to replay'
mkdir -p "$PREVIEW_DIR/recording" "$OUTPUT_DIR"
espeak-ng -v en-gb -s 150 -p 35 -w "$OUTPUT_DIR/voice-raw.wav" \
  "Good evening, sir. It is fourteen degrees in Copenhagen, with light rain expected after nine. I have dimmed the living room lights and started the coffee. Shall I read your messages?"
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/voice-raw.wav" -ac 1 -ar 16000 -c:a pcm_s16le "$OUTPUT_DIR/voice.wav"
bun "$PREVIEW_DIR/analyse-voice.ts" "$OUTPUT_DIR/voice.wav" "$PREVIEW_DIR/recording/jarvis-voice.json" "$VOICE_SLOWDOWN"

# --- The app, with the replayed voice ---------------------------------------

# Built before any emulator is running, on purpose. The native build compiles
# Skia, Reanimated and Worklets' C++ and took over half an hour on a 16 GB
# machine; with an emulator booted beside it, the emulator was killed by a
# segmentation fault partway through. Nothing about the build needs a device.
echo '→ Building the release app with the replayed voice (x86_64, for the emulator)'
bunx turbo initialize --filter=mobile >/dev/null
(cd mobile && bunx expo prebuild --platform android --no-install >/dev/null)
rm -rf "$GENERATED_BUNDLE_DIR"
(cd mobile/android && JARVIS_VOICE_REPLAY=1 ./gradlew app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64)
APK='mobile/android/app/build/outputs/apk/release/app-release.apk'
[ -f "$APK" ] || fail "The build did not produce $APK."

# --- The emulator -----------------------------------------------------------

if [ -z "$(adb devices | awk 'NR>1 && $2=="device" {print $1}')" ]; then
  echo "→ Booting $AVD_NAME (headless)"
  emulator -avd "$AVD_NAME" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &
  started_emulator=true
  timeout "$BOOT_TIMEOUT_SECONDS" adb wait-for-device || fail "No emulator appeared within ${BOOT_TIMEOUT_SECONDS}s."
  deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = '1' ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "Emulator did not finish booting within ${BOOT_TIMEOUT_SECONDS}s."
    sleep 3
  done
  echo '  booted'
else
  # Said out loud, because it is not $AVD_NAME: a different screen size draws at a
  # different rate, and the slowdown was chosen for that AVD.
  echo "→ Using the device already attached ($(adb shell wm size | tr -d '\r')), not booting $AVD_NAME"
fi

echo '→ Installing it'
adb install -r "$APK" >/dev/null

# The same device preparation verify-assistant-on-emulator.sh explains at length:
# the screen kept on and the lock screen off.
adb shell input keyevent 224
adb shell svc power stayon true
adb shell locksettings set-disabled true >/dev/null || true
adb shell wm dismiss-keyguard

# A loaded machine makes the emulator's SystemUI stall into "System UI isn't
# responding" dialogs — not once at boot, but at any point — and one sitting over
# the app swallows every tap. Cleared before each step that touches the screen.
clear_system_dialogs() {
  case "$(adb shell dumpsys window | grep -m1 mCurrentFocus || true)" in
    *'Not Responding'*)
      adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null
      sleep 10
      adb shell input keyevent 224
      adb shell wm dismiss-keyguard
      ;;
  esac
}

# The UI tree, one element per line. Only usable on a still screen: uiautomator
# waits for the UI to go idle, which the animating conversation screen never is.
ui_texts() {
  adb shell rm -f /sdcard/ui.xml
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb exec-out cat /sdcard/ui.xml 2>/dev/null | tr '>' '\n'
}

# Centre of the first element whose `$1` attribute equals `$2`.
ui_centre() {
  ui_texts | grep -F "$1=\"$2\"" | head -1 |
    sed -nE 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p' |
    awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

# The text shown in the input that follows the label `$1`.
field_value() {
  ui_texts | sed -nE 's/.*text="([^"]*)".*/\1/p' | awk -v label="$1" 'found { print; exit } $0 == label { found = 1 }'
}

# Replaces what the input labelled `$1` holds with `$2`, and checks it all
# arrived: on a loaded emulator `input text` drops characters. A masked field
# shows one dot per character, so for `$3` = masked only the length is checked.
type_into_field() {
  local label="$1" value="$2" masked="$3" attempt shown
  for attempt in 1 2 3; do
    clear_system_dialogs
    adb shell input tap $(ui_centre text "$(field_value "$label")")
    adb shell input keyevent KEYCODE_MOVE_END
    # One call with forty key codes, not forty calls.
    adb shell input keyevent $(printf 'KEYCODE_DEL %.0s' $(seq 1 40))
    adb shell input text "$value"
    sleep 3
    shown="$(field_value "$label")"
    if [ "$masked" = masked ]; then
      [ "${#shown}" -eq "${#value}" ] && return 0
    else
      [ "$shown" = "$value" ] && return 0
    fi
    echo "  '$label' came out as '$shown'; typing it again"
  done
  fail "Could not type into '$label' after three attempts."
}

# Where the hologram is on screen, from a screenshot (see find-hologram.ts).
find_hologram() {
  adb exec-out screencap -p >"$OUTPUT_DIR/screen.png"
  bun "$PREVIEW_DIR/find-hologram.ts" "$OUTPUT_DIR/screen.png" 2>/dev/null
}

echo '→ Getting past the settings screen'
clear_system_dialogs
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
deadline=$((SECONDS + 90))
until ui_texts | grep -qF 'text="API key"' || find_hologram >/dev/null; do
  [ "$SECONDS" -lt "$deadline" ] || fail "The app showed neither its settings nor the hologram within 90s."
  clear_system_dialogs
  sleep 5
done

if ! find_hologram >/dev/null; then
  # The hologram lives on the conversation screen, which needs *some* settings.
  # Nothing is contacted: the replayed voice needs no session, and these are
  # placeholders, not credentials.
  type_into_field 'API key' 'sk_not-a-real-key' masked
  type_into_field 'Agent ID' 'agent_not-a-real-agent' plain
  adb shell input keyevent 4
  sleep 3
  clear_system_dialogs
  adb shell input tap $(ui_centre text 'Save')
fi

echo '→ Waiting for the hologram'
deadline=$((SECONDS + 90))
until bounds="$(find_hologram)"; do
  [ "$SECONDS" -lt "$deadline" ] || fail "No hologram on screen within 90s of saving the settings — see $OUTPUT_DIR/screen.png."
  clear_system_dialogs
  sleep 5
done
read -r left top width height <<<"$bounds"
# A margin, so the swell with loud speech stays inside the measured area.
margin=$((width / 12))
left=$((left > margin ? left - margin : 0))
top=$((top - margin))
width=$((width + 2 * margin))
height=$((height + 2 * margin))
echo "  hologram at ${left},${top} ${width}x${height}"
cp "$OUTPUT_DIR/screen.png" "$OUTPUT_DIR/conversation-screen.png"

# --- Look, and measure ------------------------------------------------------

echo "→ Recording the screen for ${RECORD_SECONDS}s"
clear_system_dialogs
adb shell rm -f /sdcard/hologram.mp4
adb shell screenrecord --time-limit "$RECORD_SECONDS" /sdcard/hologram.mp4
adb pull /sdcard/hologram.mp4 "$OUTPUT_DIR/hologram.mp4" >/dev/null

echo '→ Measuring it'
crop="crop=${width}:${height}:${left}:${top}"
# Mean brightness of the hologram in every frame, resampled to a steady rate.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" \
  -vf "fps=25,$crop,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$OUTPUT_DIR/brightness.txt" -f null -
# How much it changes from one tenth of a second to the next.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" \
  -vf "fps=10,$crop,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$OUTPUT_DIR/motion.txt" -f null -
# Stills twice a second, for looking at.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" -vf "fps=2,$crop" "$OUTPUT_DIR/frame-%03d.png"

bun "$PREVIEW_DIR/measure-pulse.ts" "$PREVIEW_DIR/recording/jarvis-voice.json" "$OUTPUT_DIR/brightness.txt" \
  "$SILENCE_MS" "$OUTPUT_DIR/pulse.json" "$OUTPUT_DIR/motion.txt" ||
  fail "The hologram did not animate, or did not pulse with the voice — see $OUTPUT_DIR/pulse.json."

echo
echo "✓ The hologram animates, and pulses with Jarvis's voice. Evidence in $OUTPUT_DIR/."
