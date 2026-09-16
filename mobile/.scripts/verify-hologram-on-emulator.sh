#!/bin/bash
# Look at the Jarvis hologram on an emulator, and measure that it stirs with a voice without flashing.
#
# The hologram's drawing is covered offline (`hologram/src/hologram-drawing.spec.ts`
# renders it headlessly), but whether it animates in the app, on the UI thread,
# through Reanimated and native Skia, is something only a running Android shows.
# An emulator has no ElevenLabs session to listen to, so the voice comes from one
# of two places, chosen with JARVIS_VOICE:
#
#   microphone (the default) — the app as it ships, in sample mode, with a voice
#     played into the emulator's microphone over its gRPC controller (see
#     `tests/hologram-preview/inject-microphone.ts`). This goes through
#     everything a phone does: WebRTC's recorder, `modules/jarvis-audio`, the
#     analysis in `hologram/src/voice-analysis.ts`, the hologram. Before looking at the
#     hologram it plays a tone and checks the app heard it exactly as loud as
#     Android's own audio HAL measured it — which a sample read with its bytes
#     swapped would not be.
#   replay — the app built with a recorded voice in place of the live one (see
#     `metro.config.js` and `tests/hologram-preview/jarvis-voice.replay.ts`),
#     replaying readings made offline. Nothing native about the audio is
#     exercised; it isolates the drawing.
#
# Either way it then records the screen and checks two things:
#   1. the hologram keeps moving while the voice is silent;
#   2. it grows busier while the voice speaks — how much it changes from one tenth
#      of a second to the next, against the agitation envelope the app's own
#      tracker makes from the same voice, by correlation with a reversed-agitation
#      control — and it glows while he speaks, within a ceiling that stops the
#      sphere becoming a level meter. The film shows speech as activity alone, and
#      this check used to fail any brightening at all; the glow is here because the
#      user asked for it back, on top of the activity rather than instead of it.
#      Thresholds live in `tests/hologram-preview/measure-pulse.ts`.
#
# Screenshots, the screen recording and the measurements are left in
# mobile/tests/hologram-preview/evidence/ — not under dist/, which every web
# export (and so every `turbo e2e`) deletes.
#
# Usage:
#   ./mobile/.scripts/verify-hologram-on-emulator.sh
#   JARVIS_VOICE=replay ./mobile/.scripts/verify-hologram-on-emulator.sh
#
# Needs what verify-assistant-on-emulator.sh needs (KVM, the Android SDK), plus
# espeak-ng and ffmpeg, and its own small AVD, jarvis-hologram-check (or
# JARVIS_AVD). The preflight prints how to create it.
set -euo pipefail

cd "$(dirname "$0")/../.."

PACKAGE='com.ffmathy.heyjarvis'
VOICE_SOURCE="${JARVIS_VOICE:-microphone}"
# A 540x960 screen rather than the Pixel 6's 1080x2400. The emulator draws with
# a software GPU, which drew the Pixel 6 screen at under two frames a second with
# the app answering "not responding"; at a quarter of the pixels it manages about
# 2.7, which is what VOICE_SLOWDOWN below was chosen for.
AVD_NAME="${JARVIS_AVD:-jarvis-hologram-check}"
BOOT_TIMEOUT_SECONDS="${JARVIS_BOOT_TIMEOUT_SECONDS:-600}"
# The emulator's gRPC controller, for playing audio into its microphone.
GRPC_PORT=8554
PREVIEW_DIR='mobile/tests/hologram-preview'
OUTPUT_DIR="$PREVIEW_DIR/evidence"
RECORDING="$PREVIEW_DIR/recording/jarvis-voice.json"
# Silence before each playing of the line. Must match SILENCE_MS in
# tests/hologram-preview/jarvis-voice.replay.ts.
SILENCE_MS=6000
# The voice is played this many times slower than it was spoken. An emulator
# draws with a software GPU, and measured at 2–3 frames a second for the hologram
# (a phone draws on its GPU at full rate): far too slow to follow syllables four
# times a second, which would make "does it follow the voice" unanswerable here
# however correct the app is. Slowed down, the syllables come slowly enough to
# see. Nothing else changes — the analysis, the folding, the easing (in real
# time) and the drawing are the app's own, and the thresholds in measure-pulse.ts
# are the same as for a real-time run.
VOICE_SLOWDOWN=8
# The line is played in bursts of this long with a silence of the same length
# between them, rather than as one unbroken speech. This is for the measurement,
# not the look: what is checked is whether the hologram's activity follows the
# voice, and a recording that is 94% speech gives that comparison almost nothing
# to hold on to — the reference is then nearly a constant, and even a perfect
# hologram could not correlate with it above about 0.3. Alternating halves make
# the comparison meaningful without touching a single threshold.
# How long he talks, and how long he pauses, in turn — cycled, and deliberately uneven.
#
# These were 6 and 6. The activity measurement's control is the same agitation envelope played
# backwards — the same statistics with the wrong timing, so that a match cannot be luck — and a
# regular six-on six-off loop played backwards is very nearly itself. The control was scoring
# almost as well as the real thing (a margin of 0.035 where 0.2 is required), which says nothing
# about the hologram and everything about the stimulus. Uneven turns that do not repeat within a
# pass give the control a genuinely different timing to find, and sound more like someone talking.
SPEECH_CHUNKS='3 8 5 2 9 4 6'
SILENCE_CHUNKS='7 2 5 9 3 6 4'
# A little over one and a half loops of silence plus the slowed line, which is as
# long as screenrecord records.
RECORD_SECONDS=180
# The tone the microphone check plays: 400 Hz at a tenth of full scale, an RMS
# of 0.071 (ffmpeg's sine source is an eighth of full scale, hence the ×8 below).
# The app must hear it within 1 dB of the loudness Android's own audio HAL
# measured for it. Not of the file's: the emulator's injection path doubles the
# amplitude before Android sees it — the HAL measured −17.0 dBFS (RMS 0.1413)
# for a tone injected at −23.0, and the app heard RMS 0.1406, within 0.04 dB; the
# HAL reports only tenths of a dB — so the file's level says nothing about the app.
TONE_AMPLITUDE=0.1
TONE_TOLERANCE_DB=1
# And hear the silence around it as silence.
SILENCE_RMS_HIGHEST=0.01
# The bundle Gradle generates for a release build. Built with the replayed voice,
# it must not be reused by the next ordinary release build — and Gradle does not
# know the difference — so it is removed before and after.
GENERATED_BUNDLE_DIR='mobile/android/app/build/generated/assets/react'

fail() {
  echo "✗ $1" >&2
  exit 1
}

echo "→ Checking prerequisites (voice: $VOICE_SOURCE)"
case "$VOICE_SOURCE" in
  microphone | replay) ;;
  *) fail "JARVIS_VOICE must be 'microphone' or 'replay', not '$VOICE_SOURCE'." ;;
esac
[ -r /dev/kvm ] && [ -w /dev/kvm ] || fail "/dev/kvm is missing or not usable by $(id -un); see verify-assistant-on-emulator.sh."
for tool in adb emulator espeak-ng ffmpeg ffprobe bun; do
  command -v "$tool" >/dev/null || fail "$tool is not on PATH."
done
emulator -list-avds | grep -qx "$AVD_NAME" || fail "No AVD called '$AVD_NAME'. Create the one the documented run used:
    avdmanager create avd -n '$AVD_NAME' -k 'system-images;android-34;google_apis;x86_64' -d pixel_6
    sed -i 's/^hw.lcd.width=.*/hw.lcd.width=540/; s/^hw.lcd.height=.*/hw.lcd.height=960/; s/^hw.lcd.density=.*/hw.lcd.density=240/' ~/.android/avd/$AVD_NAME.avd/config.ini
  or name another with JARVIS_AVD."
echo '  all present'

started_emulator=false
injector_pid=''
cleanup() {
  [ -n "$injector_pid" ] && kill "$injector_pid" >/dev/null 2>&1 || true
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

# Rewrites `$1` as speech in chunks of `$2` seconds separated by silences of `$3`
# seconds, into `$4`.
pace_voice() {
  local input="$1" divisor="$2" output="$3"
  local directory="$OUTPUT_DIR/paced" list piece gapFile start=0 index=0 duration speech gap
  local speechList gapList
  read -r -a speechList <<<"$SPEECH_CHUNKS"
  read -r -a gapList <<<"$SILENCE_CHUNKS"
  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")"
  rm -rf "$directory"
  mkdir -p "$directory"
  list="$directory/pieces.txt"
  : >"$list"
  while awk -v start="$start" -v duration="$duration" 'BEGIN { exit !(start < duration) }'; do
    speech="$(awk -v s="${speechList[index % ${#speechList[@]}]}" -v d="$divisor" 'BEGIN { print s / d }')"
    gap="$(awk -v s="${gapList[index % ${#gapList[@]}]}" -v d="$divisor" 'BEGIN { print s / d }')"
    piece="$(printf 'piece-%02d.wav' "$index")"
    gapFile="$(printf 'gap-%02d.wav' "$index")"
    ffmpeg -nostdin -loglevel error -y -ss "$start" -t "$speech" -i "$input" -c:a pcm_s16le "$directory/$piece"
    ffmpeg -nostdin -loglevel error -y -f lavfi -i "anullsrc=r=16000:cl=mono:d=$gap" \
      -c:a pcm_s16le "$directory/$gapFile"
    # Names alone: the concat demuxer resolves what it reads against the list's own
    # directory, so a path relative to anywhere else lands somewhere that is not there.
    printf "file '%s'\nfile '%s'\n" "$piece" "$gapFile" >>"$list"
    start="$(awk -v start="$start" -v speech="$speech" 'BEGIN { print start + speech }')"
    index=$((index + 1))
  done
  ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$list" \
    -c:a pcm_s16le -ar 16000 -ac 1 "$output"
}

# --- The voice --------------------------------------------------------------

echo '→ Recording a voice'
mkdir -p "$PREVIEW_DIR/recording" "$OUTPUT_DIR"
espeak-ng -v en-gb -s 150 -p 35 -w "$OUTPUT_DIR/voice-raw.wav" \
  "Good evening, sir. It is fourteen degrees in Copenhagen, with light rain expected after nine. I have dimmed the living room lights and started the coffee. Shall I read your messages?"
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/voice-raw.wav" -ac 1 -ar 16000 -c:a pcm_s16le "$OUTPUT_DIR/voice.wav"

if [ "$VOICE_SOURCE" = replay ]; then
  # Paced before slowing, so that each reading being held eight times longer turns
  # the chunks into the documented seconds, and the readings are taken from that.
  pace_voice "$OUTPUT_DIR/voice.wav" "$VOICE_SLOWDOWN" "$OUTPUT_DIR/voice-paced.wav"
  bun "$PREVIEW_DIR/analyse-voice.ts" "$OUTPUT_DIR/voice-paced.wav" "$RECORDING" "$VOICE_SLOWDOWN"
else
  # The audio itself slowed, pitch kept (atempo halves at most once per pass), then
  # paced, and the readings taken from that — which is what the app will be hearing.
  ffmpeg -loglevel error -y -i "$OUTPUT_DIR/voice.wav" \
    -af 'atempo=0.5,atempo=0.5,atempo=0.5' -ar 16000 -c:a pcm_s16le "$OUTPUT_DIR/voice-slowed.wav"
  pace_voice "$OUTPUT_DIR/voice-slowed.wav" 1 "$OUTPUT_DIR/voice-paced.wav"
  bun "$PREVIEW_DIR/analyse-voice.ts" "$OUTPUT_DIR/voice-paced.wav" "$RECORDING"
  # What is played into the microphone, over and over: the silence, then the paced line.
  ffmpeg -loglevel error -y \
    -f lavfi -i "anullsrc=r=16000:cl=mono:d=$((SILENCE_MS / 1000))" -i "$OUTPUT_DIR/voice-paced.wav" \
    -filter_complex '[0][1]concat=n=2:v=0:a=1' -f s16le -ac 1 -ar 16000 "$OUTPUT_DIR/microphone-loop.pcm"
  # And the tone check: two seconds of silence, three of tone, three of silence.
  ffmpeg -loglevel error -y \
    -f lavfi -i 'anullsrc=r=16000:cl=mono:d=2' \
    -f lavfi -i "sine=frequency=400:sample_rate=16000:duration=3" \
    -f lavfi -i 'anullsrc=r=16000:cl=mono:d=3' \
    -filter_complex "[1]volume=$TONE_AMPLITUDE*8[tone];[0][tone][2]concat=n=3:v=0:a=1" \
    -f s16le -ac 1 -ar 16000 "$OUTPUT_DIR/microphone-tone.pcm"
fi

# --- The app ----------------------------------------------------------------

# Built before any emulator is running, on purpose. The native build compiles
# Skia, Reanimated and Worklets' C++ and took over half an hour on a 16 GB
# machine; with an emulator booted beside it, the emulator was killed by a
# segmentation fault partway through. Nothing about the build needs a device.
echo '→ Building the release app (x86_64, for the emulator)'
bunx turbo initialize --filter=mobile >/dev/null
(cd mobile && bunx expo prebuild --platform android --no-install >/dev/null)
rm -rf "$GENERATED_BUNDLE_DIR"
if [ "$VOICE_SOURCE" = replay ]; then
  (cd mobile/android && JARVIS_VOICE_REPLAY=1 ./gradlew app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64)
else
  (cd mobile/android && ./gradlew app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64)
fi
APK='mobile/android/app/build/outputs/apk/release/app-release.apk'
[ -f "$APK" ] || fail "The build did not produce $APK."

# --- The emulator -----------------------------------------------------------

if [ -z "$(adb devices | awk 'NR>1 && $2=="device" {print $1}')" ]; then
  echo "→ Booting $AVD_NAME (headless)"
  if [ "$VOICE_SOURCE" = replay ]; then
    emulator -avd "$AVD_NAME" -no-window -no-audio -no-snapshot -gpu swiftshader_indirect >/dev/null 2>&1 &
  else
    # Audio on, and the gRPC controller up (which also switches off its token
    # check), so a voice can be played into the microphone. Not
    # -allow-host-audio: that would put this machine's own microphone there, and
    # the controller refuses to inject while another microphone is active.
    emulator -avd "$AVD_NAME" -no-window -no-snapshot -gpu swiftshader_indirect -grpc "$GRPC_PORT" >/dev/null 2>&1 &
  fi
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
  # different rate, and the slowdown was chosen for that AVD. For the microphone,
  # the attached emulator must also have been started with -grpc $GRPC_PORT.
  echo "→ Using the device already attached ($(adb shell wm size | tr -d '\r')), not booting $AVD_NAME"
fi

echo '→ Installing it'
adb install -r "$APK" >/dev/null
if [ "$VOICE_SOURCE" = microphone ]; then
  # Sample mode is only offered before the app is set up, so any settings a
  # previous run saved go — which also takes the permission, granted again after.
  adb shell pm clear "$PACKAGE" >/dev/null
  adb shell pm grant "$PACKAGE" android.permission.RECORD_AUDIO
fi

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
# waits for the UI to go idle, which a screen with the hologram on it never is.
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

# Plays a 16 kHz mono PCM file into the microphone; `--loop` to keep going.
# Always run in the background: `exec` makes the background job bun itself, so
# `kill` on its `$!` reaches bun — and its handler ends the gRPC call — rather
# than a subshell that would leave bun playing into the emulator after the script.
inject() {
  exec bun "$PREVIEW_DIR/inject-microphone.ts" "$1" "$GRPC_PORT" ${2:-}
}

clear_system_dialogs
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
deadline=$((SECONDS + 90))
until ui_texts | grep -qF 'text="API key"' || find_hologram >/dev/null; do
  [ "$SECONDS" -lt "$deadline" ] || fail "The app showed neither its settings nor the hologram within 90s."
  clear_system_dialogs
  sleep 5
done

if [ "$VOICE_SOURCE" = microphone ]; then
  echo '→ Opening sample mode'
  clear_system_dialogs
  adb shell input tap $(ui_centre text 'No key yet? Try the hologram with your own voice')
elif ! find_hologram >/dev/null; then
  echo '→ Getting past the settings screen'
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
  [ "$SECONDS" -lt "$deadline" ] || fail "No hologram on screen within 90s — see $OUTPUT_DIR/screen.png."
  clear_system_dialogs
  sleep 5
done
read -r left top width height <<<"$bounds"
# Two crops, because the two measurements want different pictures.
#
# The sphere crop is the golden region a screenshot found, with a small margin:
# it is what the silence rule judges, and that rule's threshold is an absolute
# amount of change per pixel, so the framing it was set against has to stay.
sphere_margin=$((width / 12))
sphere_left=$((left > sphere_margin ? left - sphere_margin : 0))
sphere_top=$((top > sphere_margin ? top - sphere_margin : 0))
sphere_width=$((width + 2 * sphere_margin))
sphere_height=$((height + 2 * sphere_margin))
# The wide crop adds a quarter of the sphere's width on each side — half its
# radius — because speech throws chips off the rim out past it, and a crop of the
# sphere alone would measure the one part of the picture that deliberately does
# not change while missing the part that does.
margin=$((width / 4))
left=$((left > margin ? left - margin : 0))
top=$((top > margin ? top - margin : 0))
width=$((width + 2 * margin))
height=$((height + 2 * margin))
# ffmpeg refuses a crop that leaves the frame, and a wide margin on a 540-pixel
# screen can ask for one. The screenshot the hologram was found in is the same
# size as what screenrecord will record, so it says where the edges are. Asked for
# a separator, this ffprobe's csv writer rejects a trailing space, so take its
# default comma.
IFS=, read -r screen_width screen_height < <(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 "$OUTPUT_DIR/screen.png")
width=$((left + width > screen_width ? screen_width - left : width))
height=$((top + height > screen_height ? screen_height - top : height))
sphere_width=$((sphere_left + sphere_width > screen_width ? screen_width - sphere_left : sphere_width))
sphere_height=$((sphere_top + sphere_height > screen_height ? screen_height - sphere_top : sphere_height))
echo "  hologram at ${sphere_left},${sphere_top} ${sphere_width}x${sphere_height}, measured with chips out to ${left},${top} ${width}x${height}"
cp "$OUTPUT_DIR/screen.png" "$OUTPUT_DIR/hologram-screen.png"

# --- Hearing a known loudness -------------------------------------------------

if [ "$VOICE_SOURCE" = microphone ]; then
  echo "→ Playing a tone into the microphone"
  adb logcat -c
  inject "$OUTPUT_DIR/microphone-tone.pcm" &
  tone_pid=$!
  # Four seconds in, the tone has been playing for two: the HAL's own record of
  # the signal power it captured now includes it.
  sleep 4
  adb shell dumpsys media.audio_flinger >"$OUTPUT_DIR/microphone-tone-audioflinger.txt"
  wait "$tone_pid" || fail "Could not play audio into the emulator's microphone."
  sleep 2
  # modules/jarvis-audio logs the RMS of the last 40 ms every half second of
  # audio while the hologram reads from it.
  adb logcat -d -s JarvisAudio:I >"$OUTPUT_DIR/microphone-tone.log"
  grep -oE 'rms [0-9.]+' "$OUTPUT_DIR/microphone-tone.log" | awk '{print $2}' >"$OUTPUT_DIR/microphone-tone-rms.txt" || true
  [ -s "$OUTPUT_DIR/microphone-tone-rms.txt" ] ||
    fail "The app logged no audio from the microphone — see $OUTPUT_DIR/microphone-tone.log."
  [ "$(wc -l <"$OUTPUT_DIR/microphone-tone-rms.txt")" -ge 5 ] ||
    fail "The app logged too few readings to tell the tone from the silence around it — see $OUTPUT_DIR/microphone-tone.log."
  loudest="$(sort -g "$OUTPUT_DIR/microphone-tone-rms.txt" | tail -1)"
  # The silence: the first reading, from the two seconds before the tone, and the
  # last two, from the three seconds after it — the loudest of them, so a tap that
  # kept the tone's tail cannot hide behind a silent reading taken before it.
  silence="$({ head -1 "$OUTPUT_DIR/microphone-tone-rms.txt"; tail -2 "$OUTPUT_DIR/microphone-tone-rms.txt"; } | sort -g | tail -1)"
  # The loudest signal power, in dBFS, that the HAL saw on any input stream — never
  # an output's, which would be the tone on its way to the speaker rather than the
  # microphone's reading of it.
  #
  # It used to look for audio source 7, voice communication, because that is what
  # WebRTC's recorder opens and sample mode borrowed it. Sample mode records for
  # itself now, with source 6, voice recognition, and this quietly matched nothing:
  # it found an input thread with an empty history and reported that the HAL had
  # heard no signal at all, while the app was hearing the tone perfectly. Any input
  # stream, so that changing which source the app opens cannot blind the check again.
  hal_power="$(awk '
      /^-? *Output thread/ { voice = 0; history = 0 }
      /^-? *Input thread/ { voice = 1; history = 0 }
      voice && /Signal power history/ { history = 1; next }
      history && /^ *[0-9]+-[0-9]+ / {
        for (field = 3; field <= NF; field++) {
          if ($field ~ /^-?[0-9]+\.[0-9]+$/ && (best == "" || $field + 0 > best)) best = $field + 0
        }
        next
      }
      { history = 0 }
      END { print best }' "$OUTPUT_DIR/microphone-tone-audioflinger.txt")"
  [ -n "$hal_power" ] || fail "Android's audio HAL reported no signal power — see $OUTPUT_DIR/microphone-tone-audioflinger.txt."
  hal_rms="$(awk -v power="$hal_power" 'BEGIN { printf "%.4f", 10 ^ (power / 20) }')"
  echo "  injected RMS $(awk -v amplitude="$TONE_AMPLITUDE" 'BEGIN { printf "%.4f", amplitude / sqrt(2) }'), Android's HAL measured $hal_rms ($hal_power dBFS)"
  echo "  the app heard $(wc -l <"$OUTPUT_DIR/microphone-tone-rms.txt") readings: loudest $loudest, silence around it at most $silence"
  awk -v heard="$loudest" -v measured="$hal_rms" -v tolerance="$TONE_TOLERANCE_DB" \
    'BEGIN { exit !(heard > 0 && measured > 0 && (20 * log(heard / measured) / log(10)) ^ 2 <= tolerance ^ 2) }' ||
    fail "The app heard the tone at RMS $loudest, not within ${TONE_TOLERANCE_DB} dB of the $hal_rms Android measured. Swapped bytes read many times louder."
  awk -v value="$silence" -v highest="$SILENCE_RMS_HIGHEST" 'BEGIN { exit !(value <= highest) }' ||
    fail "The silence around the tone was heard at RMS $silence, above $SILENCE_RMS_HIGHEST."

  echo '→ Playing the voice into the microphone, on a loop'
  inject "$OUTPUT_DIR/microphone-loop.pcm" --loop &
  injector_pid=$!
fi

# --- Look, and measure ------------------------------------------------------

echo "→ Recording the screen for ${RECORD_SECONDS}s"
clear_system_dialogs
adb shell rm -f /sdcard/hologram.mp4
adb shell screenrecord --time-limit "$RECORD_SECONDS" /sdcard/hologram.mp4
adb pull /sdcard/hologram.mp4 "$OUTPUT_DIR/hologram.mp4" >/dev/null
if [ -n "$injector_pid" ]; then
  kill -0 "$injector_pid" 2>/dev/null || fail "The voice stopped playing into the microphone during the recording."
  kill "$injector_pid" >/dev/null 2>&1 || true
  injector_pid=''
fi

echo '→ Measuring it'
crop="crop=${width}:${height}:${left}:${top}"
sphere_crop="crop=${sphere_width}:${sphere_height}:${sphere_left}:${sphere_top}"
# Mean brightness of the hologram in every frame, resampled to a steady rate.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" \
  -vf "fps=25,$crop,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$OUTPUT_DIR/brightness.txt" -f null -
# How much it changes from one tenth of a second to the next. Ten a second is what
# measure-pulse.ts's half-second moving average is built on — five samples a
# window — and what its per-window silence check counts coverage against, so this
# rate is part of the measurement rather than a detail of the ffmpeg call.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" \
  -vf "fps=10,$crop,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$OUTPUT_DIR/activity.txt" -f null -
# And the same over the sphere alone, for the silence rule: its threshold counts
# change per pixel, so the black margin the wide crop adds would dilute it.
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" \
  -vf "fps=10,$sphere_crop,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$OUTPUT_DIR/motion.txt" -f null -
# Stills twice a second, for looking at.
rm -f "$OUTPUT_DIR"/frame-*.png
ffmpeg -loglevel error -y -i "$OUTPUT_DIR/hologram.mp4" -vf "fps=2,$crop" "$OUTPUT_DIR/frame-%03d.png"

bun "$PREVIEW_DIR/measure-pulse.ts" "$RECORDING" "$OUTPUT_DIR/brightness.txt" \
  "$SILENCE_MS" "$OUTPUT_DIR/pulse.json" "$OUTPUT_DIR/motion.txt" "$OUTPUT_DIR/activity.txt" ||
  fail "The hologram did not animate, did not stir with the voice, or flashed with it — see $OUTPUT_DIR/pulse.json."

echo
echo "✓ The hologram animates, and stirs with the voice without flashing ($VOICE_SOURCE). Evidence in $OUTPUT_DIR/."
