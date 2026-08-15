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
#   VOICE_ID           ElevenLabs voice to speak it    (default: Mathias, see below)
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
# PLAYER=powershell is worth trying under WSL: it uses Windows' own audio stack and
# bypasses WSLg's PulseAudio, which can silently route to a sink you cannot hear.
PLAYER="${PLAYER:-}"
if [ -n "$PLAYER" ]; then
  :
elif command -v ffplay > /dev/null 2>&1; then
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

# Mathias's voice. A voice ID is a public identifier, not a credential, so it lives
# here rather than in 1Password — the test then needs only the API key to run.
# Deliberately NOT the Jarvis voice ($HEY_JARVIS_ELEVENLABS_VOICE_ID): the hey_jarvis
# model is trained on human speech, so a cloned human voice triggers it far more
# reliably than a synthetic one.
VOICE_ID="${VOICE_ID:-YxLPUUJ11i82ER1NpDzl}"
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
  #
  # Raw ElevenLabs output peaks around -13 dB, quiet enough that the device may
  # simply not hear it across a room. Normalise the PEAK to -1 dB in two passes.
  #
  # Do NOT use loudnorm here: it targets integrated (average) loudness, and on a
  # sub-second clip that is mostly silence it misjudges badly — measured output came
  # out at -29 dB peak, i.e. quieter than the input it was meant to lift.
  ffmpeg -loglevel error -y -i "$AUDIO_MP3" -ac 1 -ar 48000 -sample_fmt s16 "$AUDIO_WAV" \
    || fail "ffmpeg could not convert the audio."

  measured="$(ffmpeg -i "$AUDIO_WAV" -af volumedetect -f null /dev/null 2>&1 \
    | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
  if [ -n "$measured" ]; then
    gain="$(awk -v m="$measured" 'BEGIN { printf "%.1f", -1.0 - m }')"
    if ffmpeg -loglevel error -y -i "$AUDIO_WAV" -af "volume=${gain}dB" \
      -ac 1 -ar 48000 -sample_fmt s16 "${AUDIO_WAV}.norm" 2> /dev/null; then
      mv "${AUDIO_WAV}.norm" "$AUDIO_WAV"
      echo "   gain:    ${gain} dB applied (was ${measured} dB peak)"
    fi
  fi
  echo "   saved:   $AUDIO_WAV"
fi

if command -v ffmpeg > /dev/null 2>&1; then
  peak="$(ffmpeg -i "$AUDIO_WAV" -af volumedetect -f null /dev/null 2>&1 | grep -a -oE 'max_volume: [-0-9.]+ dB' | head -1)"
  [ -n "$peak" ] && echo "   level:   ${peak#max_volume: }"
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

# LISTEN_ONLY skips playback entirely and just watches the serial log. Use it to
# isolate the microphone from the speakers: say "Hey Jarvis" yourself and see whether
# the device reacts. If your voice triggers it but the synthesised phrase does not,
# the problem is the audio being played, not the device.
if [ -n "${LISTEN_ONLY:-}" ]; then
  echo
  echo "👂 Listening for ${LISTEN_SECONDS}s — say \"Hey Jarvis\" out loud now."
  mark="$(wc -c < "$SERIAL_LOG")"
  deadline=$((SECONDS + LISTEN_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if line="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m1 -E "$DETECT_RE")"; then
      echo
      echo "✅ The microphone and the model work — detected your voice:"
      echo "   $line"
      exit 0
    fi
    sleep 1
  done
  echo
  echo "❌ Nothing detected from live speech either."
  echo "   The device is not hearing anything, so this is not about the played audio."
  echo "   Check the hardware mute switch on the back — it overrides software mute"
  echo "   and silences the microphone entirely."
  exit 1
fi

play_once() {
  case "$PLAYER" in
    ffplay) ffplay -nodisp -autoexit -loglevel error "$AUDIO_WAV" > /dev/null 2>&1 ;;
    paplay) paplay "$AUDIO_WAV" > /dev/null 2>&1 ;;
    aplay) aplay -q "$AUDIO_WAV" > /dev/null 2>&1 ;;
    powershell)
      # Copy onto the Windows filesystem first: SoundPlayer is unreliable with the
      # \\wsl$ UNC path, and a local copy always works.
      local win_dir win_path
      win_dir="$(powershell.exe -NoProfile -Command 'Write-Host -NoNewline $env:TEMP' 2> /dev/null | tr -d '\r')"
      if [ -n "$win_dir" ]; then
        local lin_dir
        lin_dir="$(wslpath -u "$win_dir" 2> /dev/null)"
        if [ -n "$lin_dir" ] && [ -d "$lin_dir" ]; then
          cp -f "$AUDIO_WAV" "$lin_dir/hey-jarvis-wake-word.wav" 2> /dev/null
          win_path="$win_dir\\hey-jarvis-wake-word.wav"
        fi
      fi
      [ -n "${win_path:-}" ] || win_path="$(wslpath -w "$AUDIO_WAV" 2> /dev/null || echo "$AUDIO_WAV")"
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
echo "MOST LIKELY: the wake word engine is not running."
echo
echo "  micro_wake_word only ever starts from two triggers in this config:"
echo "    - voice_assistant: on_client_connected  (a HOME ASSISTANT client connects)"
echo "    - elevenlabs_stream: on_end             (a conversation finishes)"
echo
echo "  So after a fresh flash, with no Home Assistant attached, the device never"
echo "  begins listening and no amount of audio will trigger it."
echo
echo "  To start it by hand: press the centre button once to start a conversation,"
echo "  then once more to stop it. on_end fires and the wake word goes live. Re-run"
echo "  this test straight after."
echo
echo "Otherwise, in order of likelihood:"
echo "  1. Host volume — the device must actually hear it. Play $AUDIO_WAV yourself."
echo "  2. The device is muted. on_wake_word_detected does nothing while"
echo "     master_mute_switch is on."
echo "  3. The synthesised voice does not trigger the model. Try another VOICE_ID."
echo "  4. Something else holds the serial port (esphome logs, screen, another run)."
echo
if [ -s "$SERIAL_LOG" ]; then
  echo "Last serial output seen:"
  tail -20 "$SERIAL_LOG" | sed 's/^/  /'
else
  echo "No serial output was captured at all — the device may not be running, or"
  echo "$ESPHOME_DEVICE is not the right port."
fi
exit 1
