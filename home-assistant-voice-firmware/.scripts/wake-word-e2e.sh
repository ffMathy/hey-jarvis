#!/usr/bin/env bash
set -uo pipefail

# End-to-end acoustic test of the wake word, over real air.
#
# Synthesises "Hey Jarvis" with ElevenLabs TTS, plays it through the HOST speakers,
# and asserts that the USB-attached Voice PE actually heard it — by watching its
# serial log for micro_wake_word's detection line. Nothing is mocked: this exercises
# TTS, the speakers, the room, the device microphone, the VAD and the wake word model
# in one shot.
#
# The device must be physically near the host speakers and NOT muted.
#
# Usage (needs the ElevenLabs API key, so go through run-with-env.sh):
#   bun run --cwd home-assistant-voice-firmware wake-word-test
#
# Or directly:
#   bash ../.scripts/run-with-env.sh ./op.env bash ./.scripts/wake-word-e2e.sh
#
# Options (environment):
#   WAKE_WORD_TEXT     phrase to synthesise            (default "Hey Jarvis")
#   VOICE_ID           ElevenLabs voice to speak it    (default $HEY_JARVIS_ELEVENLABS_MATHIAS_VOICE_ID,
#                                                       else $HEY_JARVIS_ELEVENLABS_VOICE_ID)
#   ATTEMPTS           playbacks before giving up      (default 3)
#   LISTEN_SECONDS     wait for detection per attempt  (default 15)
#   ESPHOME_DEVICE     serial port                     (default: first /dev/ttyACM*|ttyUSB*)
#   KEEP_AUDIO         1 = keep the synthesised file and reuse it (default 1, avoids re-billing)

WAKE_WORD_TEXT="${WAKE_WORD_TEXT:-Hey Jarvis}"
ATTEMPTS="${ATTEMPTS:-3}"
LISTEN_SECONDS="${LISTEN_SECONDS:-15}"
KEEP_AUDIO="${KEEP_AUDIO:-1}"

WORK_DIR="${TMPDIR:-/tmp}/hey-jarvis-wake-word-test"
mkdir -p "$WORK_DIR"
AUDIO_MP3="$WORK_DIR/wake-word.mp3"
AUDIO_WAV="$WORK_DIR/wake-word.wav"
SERIAL_LOG="$WORK_DIR/serial.log"

# micro_wake_word.cpp logs: Detected '<wake word>' with sliding average probability ...
DETECT_RE="Detected '[^']*[Jj]arvis'"
# on_wake_word_detected starts the ElevenLabs stream; a useful secondary signal.
STREAM_RE="elevenlabs_stream|Voice assistant|wake_word_triggered"

reader_pid=""
cleanup() {
  [ -n "$reader_pid" ] && kill "$reader_pid" 2> /dev/null
  [ "$KEEP_AUDIO" = "1" ] || rm -f "$AUDIO_MP3" "$AUDIO_WAV"
}
trap cleanup EXIT

fail() {
  echo "❌ $*" >&2
  exit 1
}

# --- preflight ---------------------------------------------------------------
echo "🔎 Preflight"

for tool in curl ffmpeg; do
  command -v "$tool" > /dev/null 2>&1 || fail "$tool is required. sudo apt-get install -y $tool"
done

# Playback backend: prefer a native Linux player through WSLg's PulseAudio, and
# fall back to handing the file to Windows, which always has a working audio stack.
PLAYER=""
if command -v ffplay > /dev/null 2>&1; then
  PLAYER="ffplay"
elif command -v paplay > /dev/null 2>&1; then
  PLAYER="paplay"
elif command -v aplay > /dev/null 2>&1; then
  PLAYER="aplay"
elif command -v powershell.exe > /dev/null 2>&1; then
  PLAYER="powershell"
else
  fail "No audio player found (tried ffplay, paplay, aplay, powershell.exe)."
fi
echo "   player:  $PLAYER"

if [ -z "${PULSE_SERVER:-}" ] && [ "$PLAYER" != "powershell" ]; then
  echo "   ⚠️  PULSE_SERVER is unset — audio may not reach the speakers under WSL."
  echo "      If nothing is audible, this is why. WSLg normally sets it."
fi

# Serial port
if [ -z "${ESPHOME_DEVICE:-}" ]; then
  for candidate in /dev/ttyACM* /dev/ttyUSB*; do
    [ -e "$candidate" ] && { ESPHOME_DEVICE="$candidate"; break; }
  done
fi
[ -n "${ESPHOME_DEVICE:-}" ] || fail "No serial device found. Under WSL, attach it from an ADMIN PowerShell:
     usbipd attach --wsl --busid <BUSID>"
[ -r "$ESPHOME_DEVICE" ] || fail "$ESPHOME_DEVICE is not readable by $(id -un). Try: sudo usermod -aG dialout $(id -un)"
echo "   device:  $ESPHOME_DEVICE"

# Credentials
[ -n "${HEY_JARVIS_ELEVENLABS_API_KEY:-}" ] || fail "HEY_JARVIS_ELEVENLABS_API_KEY is not set.
   Run through: bash ../.scripts/run-with-env.sh ./op.env bash ./.scripts/wake-word-e2e.sh"

VOICE_ID="${VOICE_ID:-${HEY_JARVIS_ELEVENLABS_MATHIAS_VOICE_ID:-${HEY_JARVIS_ELEVENLABS_VOICE_ID:-}}}"
[ -n "$VOICE_ID" ] || fail "No voice to speak with. Set VOICE_ID, or add
   HEY_JARVIS_ELEVENLABS_MATHIAS_VOICE_ID to elevenlabs/op.env."
echo "   voice:   $VOICE_ID"
echo "   phrase:  \"$WAKE_WORD_TEXT\""

# --- synthesise --------------------------------------------------------------
# The API key goes to curl via a stdin config file, never argv: /proc/<pid>/cmdline
# is world-readable, so a key passed as an argument is visible to every local process.
call_elevenlabs() {
  local url="$1" out="$2" data="${3:-}"
  if [ -n "$data" ]; then
    printf 'header = "xi-api-key: %s"\n' "$HEY_JARVIS_ELEVENLABS_API_KEY" \
      | curl -sS --config - -w '%{http_code}' -X POST "$url" \
        -H 'Content-Type: application/json' -d "$data" -o "$out"
  else
    printf 'header = "xi-api-key: %s"\n' "$HEY_JARVIS_ELEVENLABS_API_KEY" \
      | curl -sS --config - -w '%{http_code}' "$url" -o "$out"
  fi
}

if [ -s "$AUDIO_WAV" ] && [ "$KEEP_AUDIO" = "1" ]; then
  echo "🔊 Reusing cached audio ($AUDIO_WAV)"
else
  echo "🗣️  Synthesising \"$WAKE_WORD_TEXT\" via ElevenLabs..."
  payload="$(jq -nc --arg text "$WAKE_WORD_TEXT" \
    '{text: $text, model_id: "eleven_multilingual_v2"}')"
  http="$(call_elevenlabs "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" "$AUDIO_MP3" "$payload")"

  if [ "$http" != "200" ]; then
    echo "   HTTP $http from ElevenLabs:" >&2
    # Error bodies are JSON and carry no secrets.
    head -c 500 "$AUDIO_MP3" >&2; echo >&2
    if grep -q 'missing_permissions' "$AUDIO_MP3" 2> /dev/null; then
      echo >&2
      echo "   The API key lacks the required permission. In the ElevenLabs dashboard" >&2
      echo "   (Profile -> API Keys), grant this key:" >&2
      echo "     - text_to_speech   (required to synthesise the phrase)" >&2
      echo "     - voices_read      (optional, to look up voices by name)" >&2
    fi
    fail "Could not synthesise the test phrase."
  fi

  # 16-bit mono 48kHz: what the device's mic path expects, and universally playable.
  ffmpeg -loglevel error -y -i "$AUDIO_MP3" -ac 1 -ar 48000 -sample_fmt s16 "$AUDIO_WAV" \
    || fail "ffmpeg could not convert the audio."
  echo "   saved:   $AUDIO_WAV"
fi

# --- capture serial ----------------------------------------------------------
echo "📡 Capturing serial from $ESPHOME_DEVICE"
stty -F "$ESPHOME_DEVICE" 115200 raw -echo 2> /dev/null \
  || echo "   ⚠️  Could not configure $ESPHOME_DEVICE; reading anyway."

: > "$SERIAL_LOG"
cat "$ESPHOME_DEVICE" >> "$SERIAL_LOG" 2> /dev/null &
reader_pid=$!
sleep 2

if [ ! -s "$SERIAL_LOG" ]; then
  echo "   ⚠️  No serial output yet. The device may be booted and quiet — continuing."
fi

play_once() {
  case "$PLAYER" in
    ffplay) ffplay -nodisp -autoexit -loglevel error "$AUDIO_WAV" > /dev/null 2>&1 ;;
    paplay) paplay "$AUDIO_WAV" > /dev/null 2>&1 ;;
    aplay) aplay -q "$AUDIO_WAV" > /dev/null 2>&1 ;;
    powershell)
      # Hand Windows a path it understands; \\wsl$ works from the Windows side.
      local win_path
      win_path="$(wslpath -w "$AUDIO_WAV" 2> /dev/null || echo "$AUDIO_WAV")"
      powershell.exe -NoProfile -Command \
        "(New-Object Media.SoundPlayer '$win_path').PlaySync()" > /dev/null 2>&1
      ;;
  esac
}

# --- play and assert ---------------------------------------------------------
detected_line=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "▶️  Attempt $attempt/$ATTEMPTS — playing through host speakers..."
  mark="$(wc -c < "$SERIAL_LOG")"
  play_once

  deadline=$((SECONDS + LISTEN_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # Only look at output produced since this attempt started.
    if detected_line="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m1 -E "$DETECT_RE")"; then
      echo
      echo "✅ PASS — the device heard it."
      echo "   $detected_line"
      follow_up="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m3 -E "$STREAM_RE")"
      if [ -n "$follow_up" ]; then
        echo "   Follow-on activity:"
        printf '     %s\n' "$follow_up"
      else
        echo "   ⚠️  Wake word detected, but no ElevenLabs stream activity followed."
        echo "      Check that master_mute_switch is off and the device has WiFi."
      fi
      exit 0
    fi
    sleep 1
  done
  echo "   no detection within ${LISTEN_SECONDS}s"
done

# --- failure diagnostics -----------------------------------------------------
echo
echo "❌ FAIL — no wake word detection after $ATTEMPTS attempt(s)."
echo
echo "Things to check, roughly in order of likelihood:"
echo "  1. Host volume — the device needs to actually hear it. Play $AUDIO_WAV yourself."
echo "  2. The device is muted. on_wake_word_detected does nothing while"
echo "     master_mute_switch is on."
echo "  3. The device is not running this firmware yet, or is still booting."
echo "  4. The synthesised voice does not trigger the model. The hey_jarvis model is"
echo "     trained on human speech — try a different VOICE_ID, or raise the volume."
echo "  5. Something else holds the serial port (esphome logs, screen, another run)."
echo
if [ -s "$SERIAL_LOG" ]; then
  echo "Last serial output seen:"
  tail -20 "$SERIAL_LOG" | sed 's/^/  /'
else
  echo "No serial output was captured at all — the device may not be running, or"
  echo "$ESPHOME_DEVICE is not the right port."
fi
exit 1
