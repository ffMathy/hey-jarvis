#!/usr/bin/env bash
set -uo pipefail

# End-to-end acoustic test of the Voice PE: wake word, conversation, and playback
# fidelity — all over real air, nothing mocked.
#
#   1. Synthesise "Hey Jarvis" (ElevenLabs TTS) and play it through HOST speakers
#   2. Assert the device heard it, via micro_wake_word's serial log line
#   3. Wait for the device to finish its activation chime and open its microphone
#   4. Speak a full sentence so the agent gives a substantial reply
#   5. Only NOW start recording the room, and keep going until the call ends
#   6. Download what ElevenLabs actually produced for that same conversation
#   7. Ask Gemini to COMPARE the two and report the differences
#
# Step 7 is the point. ElevenLabs' own recording is the reference — what the agent
# meant to say. The room recording is what the speaker actually produced. Comparing
# them catches dropouts, stutters, truncated endings, missing words and timing drift,
# and attributes them to the device rather than to the model. Judging the room
# recording alone can only ever guess at what it was supposed to sound like.
#
# The device must be near the host speakers and NOT muted. Check the HARDWARE mute
# switch on the back: it overrides the software one, and while it is on the wake word
# engine runs happily on a silent microphone, so nothing ever triggers and the failure
# looks identical to a model that will not fire.
#
# Usage (needs ElevenLabs + Gemini keys, so go through run-with-env.sh):
#   bun run --cwd home-assistant-voice-firmware wake-word-test
#
# Options (environment):
#   WAKE_WORD_TEXT     wake phrase                     (default "Hey Jarvis")
#   COMMAND_TEXT       run a single turn with this sentence instead of the conversation
#   TURNS_FILE         file with one user turn per line (default: a six-turn conversation)
#   TURN_MAX           longest wait for one reply      (default 75)
#   REPLY_SETTLE_MS    speaker quiet time that ends a reply (default 800)
#   READY_TIMEOUT      wait for the device to open its mic (default 15)
#   VOICE_ID           ElevenLabs voice to speak with  (default: Mathias, see below)
#   ATTEMPTS           wake attempts before giving up  (default 3)
#   LISTEN_SECONDS     wait for detection per attempt  (default 15)
#   CONVERSATION_MAX   cap on conversation length      (default 90)
#   FETCH_TIMEOUT      wait for ElevenLabs to process  (default 180)
#   GEMINI_MODEL       model used for the comparison   (default gemini-flash-latest)
#   RECORD_SOURCE      PulseAudio capture source       (default RDPSource, the WSLg mic)
#   PLAYER             ffplay|paplay|aplay|powershell  (default: first available)
#   ESPHOME_DEVICE     serial port                     (default: first /dev/ttyACM*|ttyUSB*)
#   SKIP_AUDIO_CHECK   1 = wake word only, no recording or comparison
#   LISTEN_ONLY        1 = play nothing, just watch for a detection from live speech
#   WAKE_VIA           speaker (default) plays the wake phrase; api starts the
#                      conversation through the device's start_conversation action
#   DEVICE_HOST        the device's IP or hostname, for WAKE_VIA=api
#   KEEP_AUDIO         1 = reuse synthesised phrases between runs (default 1)
#
# Exit codes:
#   0  woke, and the playback matched the reference
#   1  never woke
#   2  woke, but the comparison found playback DEFECTS, or the device logged instability
#   3  woke, but the comparison could not run (silent capture, API or processing failure)
#   4  the call ended, or a reply never came, before the last turn was answered

WAKE_WORD_TEXT="${WAKE_WORD_TEXT:-Hey Jarvis}"
# The conversation, one user turn per entry. A single reply cannot show what goes wrong
# only later in a call -- a buffer that drifts, memory that leaks per turn, a reply that
# starts clean and is cut short the third time round -- so the default is several turns
# that each ask for continuous speech, ending with a goodbye that should make the agent
# call end_call. Every turn is answerable from the prompt alone, so the test does not
# depend on a working tool call.
#
# COMMAND_TEXT runs a single turn instead; TURNS_FILE reads one turn per line.
TURNS=()
if [ -n "${TURNS_FILE:-}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] && TURNS+=("$line")
  done < "$TURNS_FILE"
elif [ -n "${COMMAND_TEXT:-}" ]; then
  TURNS=("$COMMAND_TEXT")
else
  TURNS=(
    "Please introduce yourself, and tell me what you can help me with today."
    "Tell me a short story about a robot who learns to cook. Make it about six sentences long."
    "What was your favourite moment in that story, and why?"
    "Explain in a few sentences how a rainbow forms."
    "Interesting. And why is the sky blue during the day but red at sunset?"
    "Thank you, that is all for now. Goodbye."
  )
fi
[ "${#TURNS[@]}" -gt 0 ] || { echo "❌ No conversation turns given." >&2; exit 1; }
READY_TIMEOUT="${READY_TIMEOUT:-15}"
# Longest single reply to wait for, and how long the speaker must stay quiet before a
# reply counts as finished. The settle has to stay well under the agent's 3 s
# turnTimeout, or Jarvis hangs up before the next turn is spoken.
TURN_MAX="${TURN_MAX:-75}"
REPLY_SETTLE_MS="${REPLY_SETTLE_MS:-800}"
ATTEMPTS="${ATTEMPTS:-3}"
LISTEN_SECONDS="${LISTEN_SECONDS:-15}"
CONVERSATION_MAX="${CONVERSATION_MAX:-90}"
FETCH_TIMEOUT="${FETCH_TIMEOUT:-180}"
# A pro model, deliberately, even though the rest of the repo uses gemini-flash-latest.
# Verified against a reference clip and a copy of it with eight 90 ms dropouts injected:
# flash called BOTH faithful with high confidence, which would have made this test
# useless — it would report "no defects" forever while the device stuttered. The pro
# model passed the clean clip and found exactly 8 defects in the glitched one, quoting
# the affected word boundaries. Do not downgrade this without re-running that check.
GEMINI_MODEL="${GEMINI_MODEL:-gemini-pro-latest}"
RECORD_SOURCE="${RECORD_SOURCE:-RDPSource}"
CHIME_RECORD_SECONDS="${CHIME_RECORD_SECONDS:-4}"
KEEP_AUDIO="${KEEP_AUDIO:-1}"

# Mathias's voice. A voice ID is a public identifier, not a credential, so it lives
# here rather than in 1Password — the test then needs only the API keys to run.
# Deliberately NOT the Jarvis voice: the hey_jarvis model is trained on human speech,
# so a cloned human voice triggers it far more reliably than a synthetic one.
VOICE_ID="${VOICE_ID:-YxLPUUJ11i82ER1NpDzl}"

WORK_DIR="${TMPDIR:-/tmp}/hey-jarvis-wake-word-test"
mkdir -p "$WORK_DIR"
AUDIO_MP3="$WORK_DIR/wake-word.mp3"
AUDIO_WAV="$WORK_DIR/wake-word.wav"
ROOM_RAW="$WORK_DIR/room-recording.wav"
ROOM_WAV="$WORK_DIR/room-16k.wav"
CHIME_WAV="$WORK_DIR/activation-chime.wav"
REF_SRC="$WORK_DIR/elevenlabs-reference.mp3"
REF_WAV="$WORK_DIR/elevenlabs-16k.wav"
CONV_JSON="$WORK_DIR/conversation.json"
LIST_JSON="$WORK_DIR/conversations.json"
GEMINI_REQ="$WORK_DIR/gemini-request.json"
GEMINI_RES="$WORK_DIR/gemini-response.json"
SERIAL_LOG="$WORK_DIR/serial.log"

# micro_wake_word.cpp logs: Detected '<wake word>' with sliding average probability ...
DETECT_RE="Detected '[^']*[Jj]arvis'"
# on_wake_word_detected starts the ElevenLabs stream; a useful secondary signal.
STREAM_RE="elevenlabs_stream|Voice assistant|wake_word_triggered"
# elevenlabs_stream.on_end restarts the engine, which is the cleanest end-of-call marker.
END_RE="Starting wake word detection"
# HANDLE_MIC reports the activation chime finishing, i.e. the device is really listening.
READY_RE="HANDLE_MIC.*activation_speaker_running=false"

reader_pid=""
recorder_pid=""
cleanup() {
  [ -n "$reader_pid" ] && kill "$reader_pid" 2> /dev/null
  [ -n "$recorder_pid" ] && kill "$recorder_pid" 2> /dev/null
  [ "$KEEP_AUDIO" = "1" ] || rm -f "$AUDIO_MP3" "$AUDIO_WAV" "$WORK_DIR"/turn-*.mp3 "$WORK_DIR"/turn-*.wav
}
trap cleanup EXIT

fail() {
  echo "❌ $*" >&2
  exit 1
}

# API keys travel in headers via a stdin config file, never argv: /proc/<pid>/cmdline
# is world-readable, so a key passed as an argument is visible to every local process.
el_get() {
  local url="$1" out="$2"
  printf 'header = "xi-api-key: %s"\n' "$HEY_JARVIS_ELEVENLABS_API_KEY" \
    | curl -sS --config - -w '%{http_code}' "$url" -o "$out"
}
el_post() {
  local url="$1" out="$2" data="$3"
  printf 'header = "xi-api-key: %s"\n' "$HEY_JARVIS_ELEVENLABS_API_KEY" \
    | curl -sS --config - -w '%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' -d "$data" -o "$out"
}

# --- preflight ---------------------------------------------------------------
echo "🔎 Preflight"

for tool in curl ffmpeg jq base64 awk; do
  command -v "$tool" > /dev/null 2>&1 || fail "$tool is required. sudo apt-get install -y $tool"
done

if [ -z "${SKIP_AUDIO_CHECK:-}" ]; then
  if ffmpeg -hide_banner -sources pulse 2>&1 | grep -q "$RECORD_SOURCE"; then
    echo "   mic:     $RECORD_SOURCE"
  else
    echo "   ⚠️  Capture source '$RECORD_SOURCE' not listed. Available:"
    ffmpeg -hide_banner -sources pulse 2>&1 | sed 's/^/      /' | head -6
    echo "      Set RECORD_SOURCE=<name>, or SKIP_AUDIO_CHECK=1 for the wake word only."
  fi
fi

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
fi

if [ -z "${ESPHOME_DEVICE:-}" ]; then
  for candidate in /dev/ttyACM* /dev/ttyUSB*; do
    [ -e "$candidate" ] && { ESPHOME_DEVICE="$candidate"; break; }
  done
fi
[ -n "${ESPHOME_DEVICE:-}" ] || fail "No serial device found. Under WSL, attach it from an ADMIN PowerShell:
     usbipd attach --wsl --busid <BUSID>"
[ -r "$ESPHOME_DEVICE" ] || fail "$ESPHOME_DEVICE is not readable by $(id -un). Try: sudo usermod -aG dialout $(id -un)"
echo "   device:  $ESPHOME_DEVICE"

[ -n "${HEY_JARVIS_ELEVENLABS_API_KEY:-}" ] || fail "HEY_JARVIS_ELEVENLABS_API_KEY is not set.
   Run through: bash ../.scripts/run-with-env.sh mcp/op.env bash ./.scripts/wake-word-e2e.sh"
[ -n "${HEY_JARVIS_ELEVENLABS_AGENT_ID:-}" ] || fail "HEY_JARVIS_ELEVENLABS_AGENT_ID is not set."
echo "   voice:   $VOICE_ID"
echo "   phrase:  \"$WAKE_WORD_TEXT\", then ${#TURNS[@]} turn(s)"

# --- synthesise --------------------------------------------------------------
synthesise() {
  local text="$1" mp3="$2" wav="$3" label="$4"

  if [ -s "$wav" ] && [ "$KEEP_AUDIO" = "1" ]; then
    echo "🔊 Reusing cached $label"
    return 0
  fi

  echo "🗣️  Synthesising $label: \"$text\""
  local payload http
  payload="$(jq -nc --arg text "$text" '{text: $text, model_id: "eleven_multilingual_v2"}')"
  http="$(el_post "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" "$mp3" "$payload")"

  if [ "$http" != "200" ]; then
    echo "   HTTP $http from ElevenLabs:" >&2
    head -c 500 "$mp3" >&2; echo >&2
    if grep -q 'missing_permissions' "$mp3" 2> /dev/null; then
      echo "   Grant this API key 'text_to_speech' in the ElevenLabs dashboard." >&2
    fi
    fail "Could not synthesise $label."
  fi

  ffmpeg -loglevel error -y -i "$mp3" -ac 1 -ar 48000 -sample_fmt s16 "$wav" \
    || fail "ffmpeg could not convert $label."

  # Peak-normalise to -1 dB in two passes. Raw output peaks near -13 dB, quiet enough
  # that the device may simply not hear it. Do NOT use loudnorm: it targets integrated
  # loudness, and on a sub-second clip that is mostly silence it produced -29 dB peak,
  # quieter than the input it was meant to lift.
  local measured gain
  measured="$(ffmpeg -i "$wav" -af volumedetect -f null /dev/null 2>&1 \
    | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
  if [ -n "$measured" ]; then
    gain="$(awk -v m="$measured" 'BEGIN { printf "%.1f", -1.0 - m }')"
    if ffmpeg -loglevel error -y -i "$wav" -af "volume=${gain}dB" \
      -ac 1 -ar 48000 -sample_fmt s16 "${wav}.norm" 2> /dev/null; then
      mv "${wav}.norm" "$wav"
      echo "   gain:    ${gain} dB applied (was ${measured} dB peak)"
    fi
  fi
}

synthesise "$WAKE_WORD_TEXT" "$AUDIO_MP3" "$AUDIO_WAV" "wake phrase"

# Each turn is cached under a hash of its text and voice, so editing a turn re-synthesises
# it instead of silently replaying whatever an older run left behind.
TURN_WAVS=()
if [ -z "${SKIP_AUDIO_CHECK:-}" ]; then
  for i in "${!TURNS[@]}"; do
    key="$(printf '%s|%s' "$VOICE_ID" "${TURNS[$i]}" | sha1sum | cut -c1-12)"
    synthesise "${TURNS[$i]}" "$WORK_DIR/turn-$key.mp3" "$WORK_DIR/turn-$key.wav" "turn $((i + 1))"
    TURN_WAVS+=("$WORK_DIR/turn-$key.wav")
  done
fi

# --- capture serial ----------------------------------------------------------
echo "📡 Capturing serial from $ESPHOME_DEVICE"
stty -F "$ESPHOME_DEVICE" 115200 raw -echo 2> /dev/null \
  || echo "   ⚠️  Could not configure $ESPHOME_DEVICE; reading anyway."

: > "$SERIAL_LOG"
cat "$ESPHOME_DEVICE" >> "$SERIAL_LOG" 2> /dev/null &
reader_pid=$!
sleep 2

play_file() {
  local f="$1"
  case "$PLAYER" in
    ffplay) ffplay -nodisp -autoexit -loglevel error "$f" > /dev/null 2>&1 ;;
    paplay) paplay "$f" > /dev/null 2>&1 ;;
    aplay) aplay -q "$f" > /dev/null 2>&1 ;;
    powershell)
      # Copy onto the Windows filesystem first: SoundPlayer is unreliable with the
      # \\wsl$ UNC path, and a local copy always works.
      local win_dir win_path lin_dir
      win_dir="$(powershell.exe -NoProfile -Command 'Write-Host -NoNewline $env:TEMP' 2> /dev/null | tr -d '\r')"
      if [ -n "$win_dir" ]; then
        lin_dir="$(wslpath -u "$win_dir" 2> /dev/null)"
        if [ -n "$lin_dir" ] && [ -d "$lin_dir" ]; then
          cp -f "$f" "$lin_dir/hey-jarvis-play.wav" 2> /dev/null
          win_path="$win_dir\\hey-jarvis-play.wav"
        fi
      fi
      [ -n "${win_path:-}" ] || win_path="$(wslpath -w "$f" 2> /dev/null || echo "$f")"
      powershell.exe -NoProfile -Command \
        "(New-Object Media.SoundPlayer '$win_path').PlaySync()" > /dev/null 2>&1
      ;;
  esac
}

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

# --- start recording the room ------------------------------------------------
# Recording spans the WHOLE exchange, starting before the wake phrase, so the capture
# contains both what we played and what the device said back.
# Recording starts AFTER the last thing we play, never during it. WSLg's audio is an
# RDP transport, and holding a capture stream open while playing degrades playback
# badly and progressively: measured on a 2 s tone, playback took 2.1 s alone but
# 4.5 s, then 11.6 s, then 13.3 s with a recorder running, recovering to 2.1 s the
# moment it stopped. Recording through the wake phrase therefore mangles the very
# audio the device is supposed to recognise, and each cycle sounds worse than the
# last. The reply is what we need to capture, and it arrives after we stop talking.

# Epoch before anything happens, so the conversation lookup cannot match an older call.
started_at="$(date +%s)"

# --- wake the device ---------------------------------------------------------
detected_line=""
woke=0

# WAKE_VIA=api starts the conversation through the device's start_conversation action
# instead of playing the wake phrase. A synthesised "Hey Jarvis" from laptop speakers
# scores well below the hey_jarvis cutoff even where a real voice in the same room
# wakes the device, so this keeps the conversation under test independent of how
# well the host can imitate a person.
if [ "${WAKE_VIA:-speaker}" = "api" ]; then
  [ -n "${DEVICE_HOST:-}" ] || fail "WAKE_VIA=api needs DEVICE_HOST, the device's IP address or hostname."
  # aioesphomeapi ships with ESPHome; run it on the interpreter ESPHome itself uses.
  esphome_python="$(head -1 "$(command -v esphome)" | sed 's/^#!//')"
  [ -x "$esphome_python" ] || fail "Could not find ESPHome's Python to reach the device API."
  echo "▶️  Starting the conversation over the API at $DEVICE_HOST..."
  mark="$(wc -c < "$SERIAL_LOG")"
  "$esphome_python" - "$DEVICE_HOST" <<'PY' || fail "Could not call start_conversation on the device."
import asyncio, sys
from aioesphomeapi import APIClient

async def main(host):
    client = APIClient(host, 6053, None)
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    service = next((s for s in services if s.name == "start_conversation"), None)
    if service is None:
        sys.exit("the device has no start_conversation action; flash a current build")
    await client.execute_service(service, {})
    await asyncio.sleep(0.5)
    await client.disconnect()

asyncio.run(main(sys.argv[1]))
PY
  deadline=$((SECONDS + LISTEN_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -q "START_STREAM CALLED"; then
      echo "✅ Conversation started."
      woke=1
      break
    fi
    sleep 0.5
  done
  ATTEMPTS=0
fi

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "▶️  Attempt $attempt/$ATTEMPTS — playing the wake phrase..."
  mark="$(wc -c < "$SERIAL_LOG")"
  play_file "$AUDIO_WAV"

  deadline=$((SECONDS + LISTEN_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # Only look at output produced since this attempt started.
    if detected_line="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m1 -E "$DETECT_RE")"; then
      echo "✅ Wake word detected."
      echo "   $detected_line"
      woke=1
      break 2
    fi
    sleep 1
  done
  echo "   no detection within ${LISTEN_SECONDS}s"
done

if [ "$woke" != "1" ]; then
  [ -n "$recorder_pid" ] && kill "$recorder_pid" 2> /dev/null
  echo
  echo "❌ FAIL — no wake word detection after $ATTEMPTS attempt(s)."
  echo
  echo "MOST LIKELY: the microphone is muted, or the wake word engine is not running."
  echo
  echo "  The HARDWARE mute switch on the back overrides the software one. While it is"
  echo "  on, the engine runs happily on a silent microphone and nothing can trigger it."
  echo "  This looks identical to a model that simply never fires. Check it first."
  echo
  echo "Otherwise, in order of likelihood:"
  echo "  1. Host volume — the device must actually hear it. Play $AUDIO_WAV yourself."
  echo "  2. Run LISTEN_ONLY=1 and speak the wake word to isolate mic from speakers."
  echo "  3. The synthesised voice does not trigger the model. Try another VOICE_ID."
  echo "  4. Something else holds the serial port (esphome logs, screen, another run)."
  echo
  if [ -s "$SERIAL_LOG" ]; then
    echo "Last serial output seen:"
    tail -20 "$SERIAL_LOG" | sed 's/^/  /'
  else
    echo "No serial output captured at all — is $ESPHOME_DEVICE the right port?"
  fi
  exit 1
fi

if [ -n "${SKIP_AUDIO_CHECK:-}" ]; then
  echo
  echo "⏭️  SKIP_AUDIO_CHECK set — stopping after the wake word."
  exit 0
fi

# --- hold the conversation ---------------------------------------------------
# VOLUME_CHECK records the activation chime on its own, before the command is spoken,
# so its level can be compared against the reply's. The two sounds travel different
# speaker paths on the device, and only one of them used to follow the volume dial.
#
# Recorded in a separate window rather than one continuous capture because recording
# while the host is playing degrades WSLg audio badly (see the note above the reply
# recording). The chime plays immediately after the wake word, while the host is
# silent, so it gets a clean window of its own.
chime_peak=""
if [ -n "${VOLUME_CHECK:-}" ]; then
  echo "🔔 Recording the activation chime (${CHIME_RECORD_SECONDS}s)"
  ffmpeg -hide_banner -loglevel error -y -f pulse -i "$RECORD_SOURCE" \
    -t "$CHIME_RECORD_SECONDS" -ac 1 -ar 16000 -sample_fmt s16 "$CHIME_WAV" > /dev/null 2>&1
  chime_peak="$(ffmpeg -i "$CHIME_WAV" -af volumedetect -f null /dev/null 2>&1 \
    | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
  echo "   chime peak: ${chime_peak:-?} dB"
fi

# Wait for the device to actually be listening before speaking.
#
# Waking is not the same as being ready. The device opens the stream, then plays its
# activation chime, and deliberately holds its microphone back until that finishes --
# it logs "Starting microphone enable timeout: 817 ms, 1750 ms grace period" for
# exactly this reason. Speaking into that window means the command is simply never
# heard, which from the room sounds like the wake phrase and the command running into
# each other with nothing in between.
#
# HANDLE_MIC logs activation_speaker_running=true while the chime plays and false once
# it stops, so that transition is the real "you may speak now" signal.
echo "⏳ Waiting for the device to finish its chime and open the mic..."
ready_mark="$(wc -c < "$SERIAL_LOG")"
deadline=$((SECONDS + READY_TIMEOUT))
ready=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if tail -c "+$((ready_mark + 1))" "$SERIAL_LOG" 2> /dev/null \
    | grep -q -E "$READY_RE"; then
    ready=1
    echo "   device is listening"
    break
  fi
  sleep 0.2
done
if [ "$ready" != "1" ]; then
  echo "   ⚠️  No listening marker within ${READY_TIMEOUT}s; speaking anyway."
  sleep 2
fi

conv_start_mark="$(wc -c < "$SERIAL_LOG")"

# speaker_is_active_ flips true on a reply's first audio and false 250 ms after the
# speaker runs dry, so one reply is one true/false pair. The reply is over once the
# counts balance and stay balanced for REPLY_SETTLE_MS -- a false followed quickly by
# another true is the speaker running dry mid-reply, which is counted as an underrun.
SPEAKER_ON_RE="Setting speaker_is_active_ = true"
SPEAKER_OFF_RE="Setting speaker_is_active_ = false"

# Waits for the reply to the turn that started at serial offset $1.
# Returns 0 when the reply finished, 1 when the call ended, 2 on timeout.
wait_for_reply() {
  local mark="$1" last="$2" on off since balanced_at=0 deadline=$((SECONDS + TURN_MAX))
  while [ "$SECONDS" -lt "$deadline" ]; do
    since="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null)"
    if printf '%s' "$since" | grep -q -E "$END_RE"; then
      return 1
    fi
    # The last turn is a goodbye, so wait for the hang-up rather than for silence:
    # that captures the whole farewell and proves end_call still closes the call.
    if [ "$last" != "1" ]; then
      on="$(printf '%s' "$since" | grep -c -- "$SPEAKER_ON_RE")"
      off="$(printf '%s' "$since" | grep -c -- "$SPEAKER_OFF_RE")"
      if [ "$on" -gt 0 ] && [ "$off" -ge "$on" ]; then
        [ "$balanced_at" -gt 0 ] || balanced_at="$(date +%s%3N)"
        if [ $(($(date +%s%3N) - balanced_at)) -ge "$REPLY_SETTLE_MS" ]; then
          REPLY_UNDERRUNS=$((on - 1))
          return 0
        fi
      else
        balanced_at=0
      fi
    fi
    sleep 0.1
  done
  return 2
}

SEGMENTS=()
answered=0
premature=""
total_underruns=0
for i in "${!TURNS[@]}"; do
  n=$((i + 1))
  is_last=0
  [ "$n" -eq "${#TURNS[@]}" ] && is_last=1
  turn_mark="$(wc -c < "$SERIAL_LOG")"

  echo "🗨️  Turn $n/${#TURNS[@]}: \"${TURNS[$i]}\""
  play_file "${TURN_WAVS[$i]}"

  # Playback is done; only now is it safe to open a capture stream.
  segment="$WORK_DIR/room-turn-$n.wav"
  ffmpeg -hide_banner -loglevel error -y -f pulse -i "$RECORD_SOURCE" \
    -t "$TURN_MAX" -ac 1 -ar 16000 -sample_fmt s16 "$segment" > /dev/null 2>&1 &
  recorder_pid=$!

  turn_started=$SECONDS
  REPLY_UNDERRUNS=0
  wait_for_reply "$turn_mark" "$is_last"
  outcome=$?

  # After a hang-up the speaker may still be draining the farewell.
  [ "$outcome" = "1" ] && sleep 2
  kill "$recorder_pid" 2> /dev/null
  wait "$recorder_pid" 2> /dev/null
  recorder_pid=""
  [ -s "$segment" ] && SEGMENTS+=("$segment")

  case "$outcome" in
    0)
      answered=$n
      total_underruns=$((total_underruns + REPLY_UNDERRUNS))
      echo "   replied in $((SECONDS - turn_started))s, ${REPLY_UNDERRUNS} underrun(s)"
      ;;
    1)
      if [ "$is_last" = "1" ]; then
        answered=$n
        echo "   farewell played and the call ended after $((SECONDS - turn_started))s"
      else
        premature="the call ended during turn $n of ${#TURNS[@]}"
        echo "   ❌ $premature"
      fi
      ;;
    2)
      premature="no end to the reply within ${TURN_MAX}s on turn $n of ${#TURNS[@]}"
      echo "   ❌ $premature"
      ;;
  esac
  [ -z "$premature" ] || break
done

# --- device health -----------------------------------------------------------
# Deterministic signs of instability in the serial log, independent of any model:
# a crash or reboot, the speaker stalling (audio is dropped), allocation failures,
# and the error handler. None of them belongs in a healthy conversation.
conv_log="$WORK_DIR/conversation-serial.log"
tail -c "+$((conv_start_mark + 1))" "$SERIAL_LOG" > "$conv_log" 2> /dev/null
INSTABILITY_RE="Guru Meditation|abort\(\)|Backtrace:|rst:0x|Speaker stalled|Could not allocate|Failed to decode|ERROR HANDLER CALLED|LOW MEMORY|Task watchdog"
instability="$(grep -a -E "$INSTABILITY_RE" "$conv_log" | head -10)"
# First and last reading, plus the low point. Internal RAM is the one to watch: it is
# much scarcer than PSRAM, and running out of it is what rebooted the device mid-reply.
mem_trend() {
  grep -a -oE "$1=[0-9]+KB" "$conv_log" | grep -oE '[0-9]+' \
    | awk 'NR==1{f=$1; m=$1} {l=$1; if ($1 < m) m=$1} END{if (NR) printf "%s -> %s KB (low %s)", f, l, m}'
}
psram_trend="$(mem_trend 'PSRAM Free')"
internal_trend="$(mem_trend 'Internal Free')"
echo "🩺 Device health"
echo "   turns answered: $answered/${#TURNS[@]}, underruns: $total_underruns"
[ -z "$psram_trend" ] || echo "   PSRAM free:    $psram_trend"
[ -z "$internal_trend" ] || echo "   internal free: $internal_trend"
if [ -n "$instability" ]; then
  echo "   ❌ instability in the serial log:"
  printf '%s\n' "$instability" | sed 's/^/      /'
fi

[ "${#SEGMENTS[@]}" -gt 0 ] || fail "Nothing was recorded from '$RECORD_SOURCE'."

# One clip for the comparison: each reply in order, joined by a second of silence where
# the user's turn was (and was deliberately not recorded).
concat_inputs=()
concat_filter=""
for s in "${!SEGMENTS[@]}"; do
  concat_inputs+=(-i "${SEGMENTS[$s]}")
  concat_filter+="[$s:a]apad=pad_dur=1[s$s];"
done
for s in "${!SEGMENTS[@]}"; do concat_filter+="[s$s]"; done
concat_filter+="concat=n=${#SEGMENTS[@]}:v=0:a=1[out]"
ffmpeg -hide_banner -loglevel error -y "${concat_inputs[@]}" -filter_complex "$concat_filter" \
  -map '[out]' -ac 1 -ar 16000 -sample_fmt s16 "$ROOM_RAW" \
  || fail "Could not join the recorded replies."

room_peak="$(ffmpeg -i "$ROOM_RAW" -af volumedetect -f null /dev/null 2>&1 \
  | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
echo "   captured: $ROOM_RAW (peak ${room_peak:-?} dB)"

# Compare the two sounds' levels. They share one amplifier, so after the volume sync
# they should land close together; a large gap means the reply is not following the
# dial. Tolerance is generous because the two sounds differ in content and duration.
if [ -n "${VOLUME_CHECK:-}" ] && [ -n "$chime_peak" ] && [ -n "$room_peak" ]; then
  gap="$(awk -v a="$chime_peak" -v b="$room_peak" 'BEGIN { d = a - b; if (d < 0) d = -d; printf "%.1f", d }')"
  echo "   volume parity: chime ${chime_peak} dB vs reply ${room_peak} dB (gap ${gap} dB)"
  # TREAT THIS AS INDICATIVE, NOT AUTHORITATIVE. The window starts from the serial
  # detection line, so it catches a varying slice of a ~1.6s chime and the number moves
  # several dB between identical runs. It is useful for spotting a gross mismatch, not
  # for judging a few dB. Compare the source files directly when that matters:
  #   ffmpeg -i <file> -af volumedetect -f null /dev/null
  if awk -v g="$gap" -v t="${VOLUME_GAP_MAX_DB:-12}" 'BEGIN { exit !(g > t) }'; then
    echo "   ⚠️  The two sounds differ by more than ${VOLUME_GAP_MAX_DB:-12} dB — the dial is"
    echo "      probably not reaching both speaker paths."
  else
    echo "   ✅ Chime and reply are at comparable levels."
  fi
fi

# A silent capture means the microphone heard nothing. Comparing it would produce a
# confident-sounding verdict about silence, which is worse than saying so.
#
# The threshold has to sit below a QUIET but real capture, not just below a loud one.
# Microphone gain varies a lot between hosts: the same room measured -38 dB peak one
# day and -76 dB the next, so a -45 dB cut-off rejected perfectly usable audio. -60 dB
# still separates "nothing at all" from "faint but there"; raise it if a genuinely
# empty room slips through.
if [ -n "$room_peak" ] && awk -v p="$room_peak" -v t="${SILENCE_ABORT_DB:--60}" 'BEGIN { exit !(p < t) }'; then
  echo
  echo "⚠️  The recording is effectively silent (peak ${room_peak} dB)."
  echo "   Either the device never spoke, or the host microphone cannot hear it."
  echo "   Not comparing — the verdict would be meaningless."
  exit 3
fi

# --- fetch the reference from ElevenLabs -------------------------------------
echo "☁️  Waiting for ElevenLabs to finish processing the conversation..."
conv_id=""
deadline=$((SECONDS + FETCH_TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  http="$(el_get "https://api.elevenlabs.io/v1/convai/conversations?agent_id=${HEY_JARVIS_ELEVENLABS_AGENT_ID}&page_size=10" "$LIST_JSON")"
  if [ "$http" = "200" ]; then
    # Newest conversation that began after this run started and has finished.
    conv_id="$(jq -r --argjson since "$started_at" '
      [ .conversations[]?
        | select(.start_time_unix_secs >= ($since - 5))
        | select(.status == "done") ]
      | sort_by(.start_time_unix_secs) | last | .conversation_id // empty' "$LIST_JSON" 2> /dev/null)"
    [ -n "$conv_id" ] && break
  else
    echo "   ⚠️  conversations list returned HTTP $http"
  fi
  sleep 5
done

if [ -z "$conv_id" ]; then
  echo
  echo "⚠️  No finished conversation appeared within ${FETCH_TIMEOUT}s."
  echo "   The device woke and was recorded, but there is nothing to compare against."
  echo "   Room recording kept at: $ROOM_RAW"
  exit 3
fi
echo "   conversation: $conv_id"

http="$(el_get "https://api.elevenlabs.io/v1/convai/conversations/${conv_id}" "$CONV_JSON")"
[ "$http" = "200" ] || { echo "   ⚠️  conversation detail returned HTTP $http"; exit 3; }

transcript="$(jq -r '[ .transcript[]? | "\(.role): \(.message // "")" ] | join("\n")' "$CONV_JSON" 2> /dev/null)"
has_audio="$(jq -r '.has_audio // false' "$CONV_JSON" 2> /dev/null)"

if [ "$has_audio" != "true" ]; then
  echo
  echo "⚠️  ElevenLabs reports no audio for $conv_id, so there is no reference."
  echo "   Room recording kept at: $ROOM_RAW"
  exit 3
fi

http="$(el_get "https://api.elevenlabs.io/v1/convai/conversations/${conv_id}/audio" "$REF_SRC")"
[ "$http" = "200" ] || { echo "   ⚠️  conversation audio returned HTTP $http"; exit 3; }
echo "   reference: $REF_SRC ($(wc -c < "$REF_SRC") bytes)"

# Both sides to identical 16 kHz mono PCM, so a codec or sample-rate difference cannot
# be mistaken for a playback defect.
ffmpeg -loglevel error -y -i "$REF_SRC" -ac 1 -ar 16000 -sample_fmt s16 "$REF_WAV" \
  || fail "Could not convert the reference audio."
ffmpeg -loglevel error -y -i "$ROOM_RAW" -ac 1 -ar 16000 -sample_fmt s16 "$ROOM_WAV" \
  || fail "Could not convert the room recording."

# Peak-normalise the room capture to sit at a comparable level to the reference. A
# distant microphone can land 40 dB below the server-side audio, and handing the model
# a near-inaudible clip invites "I cannot hear the speech" regardless of quality. This
# changes loudness only -- dropouts, stutters and truncation all survive a gain change,
# so it cannot manufacture or hide a defect.
room_measured="$(ffmpeg -i "$ROOM_WAV" -af volumedetect -f null /dev/null 2>&1 \
  | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
if [ -n "$room_measured" ]; then
  room_gain="$(awk -v m="$room_measured" 'BEGIN { printf "%.1f", -1.0 - m }')"
  if ffmpeg -loglevel error -y -i "$ROOM_WAV" -af "volume=${room_gain}dB" \
    -ac 1 -ar 16000 -sample_fmt s16 "${ROOM_WAV}.norm" 2> /dev/null; then
    mv "${ROOM_WAV}.norm" "$ROOM_WAV"
    echo "   room gain: ${room_gain} dB applied (was ${room_measured} dB peak)"
  fi
fi

# --- compare -----------------------------------------------------------------
[ -n "${HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY:-}" ] \
  || fail "HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY is not set; cannot compare the audio."

# Deterministic corroboration. Dropouts show up as extra silent gaps, and counting
# them needs no model at all — so a verdict that disagrees with this is worth
# distrusting. It cannot see missing words or wrong pacing, which is why it supports
# the comparison rather than replacing it.
#
# Peak-normalise before counting. The room recording is ~25 dB quieter than the
# reference, so against a fixed floor far more of it reads as silence: measured
# unnormalised, a clean capture already showed 31 more gaps than the reference, which
# would fire this warning on every good run. Normalised, a clean capture matches the
# reference exactly (delta 0) while the glitched one stands out (delta 10).
count_gaps() {
  local f="$1" measured gain tmp
  tmp="${WORK_DIR}/gapnorm-$(basename "$f")"
  measured="$(ffmpeg -i "$f" -af volumedetect -f null /dev/null 2>&1 \
    | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
  if [ -n "$measured" ]; then
    gain="$(awk -v m="$measured" 'BEGIN { printf "%.1f", -1.0 - m }')"
    ffmpeg -loglevel error -y -i "$f" -af "volume=${gain}dB" -ac 1 -ar 16000 "$tmp" 2> /dev/null
  else
    cp -f "$f" "$tmp"
  fi
  ffmpeg -i "$tmp" -af "silencedetect=noise=${SILENCE_FLOOR:--45}dB:d=0.05" -f null /dev/null 2>&1 \
    | grep -ac "silence_start" || true
}
ref_gaps="$(count_gaps "$REF_WAV")"
room_gaps="$(count_gaps "$ROOM_WAV")"
gap_delta=$((room_gaps - ref_gaps))
echo "   gaps:    reference ${ref_gaps}, room ${room_gaps} (delta ${gap_delta})"

echo "🧠 Comparing with ${GEMINI_MODEL}..."

# Describe the two inputs and demand quoted evidence. Asking "did playback degrade?"
# invites agreement; requiring specific words and timestamps makes a false positive
# harder. Recording-side artefacts are ruled out explicitly, because the room capture
# is necessarily quieter, echoier and noisier than the reference — none of which is a
# device fault.
# `read -d ''` always exits non-zero at EOF even though PROMPT is fully populated;
# `|| true` keeps that harmless if this script ever gains `set -e`.
read -r -d '' PROMPT <<PROMPT_EOF || true
You are given two audio recordings of the SAME conversation, plus its transcript.

AUDIO 1 is the REFERENCE: what the voice service generated, captured server-side.
AUDIO 2 is a ROOM RECORDING made with a microphone, of a smart speaker playing back
the AGENT's side of that conversation out loud. The conversation has several turns.
Each reply was recorded separately, starting only after the human finished speaking,
and the replies are joined in order with about one second of silence between them. So
AUDIO 2 contains the agent's replies and little or nothing of the user's turns. A user
turn present in AUDIO 1 but absent from AUDIO 2 is therefore EXPECTED and is not a
defect, and neither is the silence that joins two replies. Check EVERY reply, including
the later ones: defects that appear only late in a long conversation matter most.

Compare AUDIO 2 against AUDIO 1 and report only defects in how the SPEAKER reproduced
the agent's speech.

Report defects_found: true if the agent's speech in AUDIO 2 is degraded relative to
AUDIO 1 in ways a listener would notice, such as:
  - repeated or re-articulated syllables, or a stammer absent from the reference
  - words or phrases chopped, dropped or missing
  - abrupt gaps, dropouts or silences inside a word or phrase
  - the reply cut off before the reference ends
  - speech playing too fast, too slow, or with wrong pitch

Report false if AUDIO 2 reproduces the same words continuously. The room recording is
necessarily quieter, more distant, echoey and noisier, and may clip at the very start
or end of the capture window. NONE of that is a defect. Background noise, room
reverberation and low volume are NOT defects. Natural pauses and breaths are NOT
defects.

In differences, quote the specific words affected and roughly where they occur, or
state plainly that the reproduction was faithful. Put the number of distinct defects
in defect_count.

Set agent_speech_audible to false if you cannot make out the agent's speech in AUDIO 2
at all. That is the most severe defect there is -- the device played nothing -- so also
set defects_found to true and say so in differences. Do NOT report a faithful
reproduction when there is no speech to compare.

About the transcript below:
  - "agent:" lines are what the service intended to say. "user:" lines are what the
    device transcribed from the room, and may be imperfect — that is speech
    recognition, not playback, so do NOT report it as a defect.
  - Text in square brackets such as [sighs], [dry] or [sounding like Jarvis from the
    Iron Man movies] are DELIVERY DIRECTIVES for the voice engine, not words to be
    spoken. Expect them to be absent from BOTH recordings, or realised as a tone of
    voice or a non-verbal sound. Their absence is NEVER a defect.
  - Compare the two recordings against EACH OTHER. The transcript is context for what
    is being said; it is not the thing under test.

TRANSCRIPT:
${transcript}
PROMPT_EOF

# base64 to FILES and read them with --rawfile. Passing them via --arg puts megabytes
# of audio into argv and fails outright with "Argument list too long" once two clips
# are involved. rtrimstr drops the trailing newline base64 may leave behind.
#
# FLAC, not WAV: a multi-turn conversation runs to minutes, and two minutes-long WAVs
# in base64 approach the 20 MB inline request limit. FLAC is lossless, so it cannot
# add or hide an artefact the way a lossy codec could.
ffmpeg -loglevel error -y -i "$REF_WAV" -c:a flac "$WORK_DIR/ref.flac" || fail "Could not encode the reference."
ffmpeg -loglevel error -y -i "$ROOM_WAV" -c:a flac "$WORK_DIR/room.flac" || fail "Could not encode the room recording."
base64 -w0 < "$WORK_DIR/ref.flac" > "$WORK_DIR/ref.b64"
base64 -w0 < "$WORK_DIR/room.flac" > "$WORK_DIR/room.b64"

jq -n \
  --arg prompt "$PROMPT" \
  --rawfile ref "$WORK_DIR/ref.b64" \
  --rawfile room "$WORK_DIR/room.b64" '
  ($ref | rtrimstr("\n")) as $ref |
  ($room | rtrimstr("\n")) as $room |
  {
  contents: [ { parts: [
    { text: $prompt },
    { text: "AUDIO 1 — REFERENCE (server-side):" },
    { inline_data: { mime_type: "audio/flac", data: $ref } },
    { text: "AUDIO 2 — ROOM RECORDING (device speaker):" },
    { inline_data: { mime_type: "audio/flac", data: $room } }
  ] } ],
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        defects_found: { type: "BOOLEAN" },
        agent_speech_audible: { type: "BOOLEAN" },
        confidence: { type: "STRING", enum: ["low", "medium", "high"] },
        defect_count: { type: "INTEGER" },
        differences: { type: "STRING" },
        reference_summary: { type: "STRING" },
        room_summary: { type: "STRING" }
      },
      required: ["defects_found", "confidence", "differences"]
    }
  }
}' > "$GEMINI_REQ"
rm -f "$WORK_DIR/ref.b64" "$WORK_DIR/room.b64"

echo "   request: $(wc -c < "$GEMINI_REQ") bytes"

printf 'header = "x-goog-api-key: %s"\n' "$HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY" \
  | curl -sS --config - -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent" \
    -H 'Content-Type: application/json' --data-binary "@$GEMINI_REQ" -o "$GEMINI_RES"

if ! verdict="$(jq -er '.candidates[0].content.parts[0].text' "$GEMINI_RES" 2> /dev/null)"; then
  echo "❌ Gemini did not return a verdict:" >&2
  head -c 600 "$GEMINI_RES" >&2; echo >&2
  exit 3
fi

echo
echo "   reference: $(printf '%s' "$verdict" | jq -r '.reference_summary // "-"')"
echo "   room:      $(printf '%s' "$verdict" | jq -r '.room_summary // "-"')"
echo "   confidence: $(printf '%s' "$verdict" | jq -r '.confidence')"
echo "   differences: $(printf '%s' "$verdict" | jq -r '.differences')"

# The conversation-level checks come before the verdict's own exits, so a dropped call
# or a crash is never reported as a mere playback defect. The verdict above is printed
# either way, because it is what says WHERE in the conversation things went wrong.
if [ -n "$premature" ]; then
  echo
  echo "❌ CONVERSATION CUT SHORT — $premature."
  echo "   serial:    $conv_log"
  echo "   room:      $ROOM_WAV"
  exit 4
fi

if [ -n "$instability" ]; then
  echo
  echo "❌ INSTABILITY — the device logged errors during the conversation (see above)."
  echo "   serial:    $conv_log"
  exit 2
fi

# Treat inaudible agent speech as a hard failure regardless of defects_found. A run
# where nothing played is the worst outcome, not a clean one, and an earlier version of
# this prompt scored exactly that as a pass three times in a row.
if [ "$(printf '%s' "$verdict" | jq -r '.agent_speech_audible // true')" = "false" ]; then
  echo
  echo "❌ NO AUDIO — the agent's speech is not audible in the room recording at all."
  echo "   The device played nothing, or nothing the microphone could hear."
  echo "   reference: $REF_WAV"
  echo "   room:      $ROOM_WAV"
  exit 2
fi

if [ "$(printf '%s' "$verdict" | jq -r '.defects_found')" = "true" ]; then
  echo
  echo "❌ PLAYBACK DEFECTS — the speaker did not faithfully reproduce the reply."
  echo "   defects:   $(printf '%s' "$verdict" | jq -r '.defect_count // "?"')"
  echo "   reference: $REF_WAV"
  echo "   room:      $ROOM_WAV"
  exit 2
fi


# The gap count is model-independent, so a clean verdict alongside a lot of extra
# silence is a signal the comparison may have missed something rather than a pass.
if [ "$gap_delta" -ge 5 ]; then
  echo
  echo "⚠️  No defects reported, but the room recording has ${gap_delta} more silent"
  echo "   gaps than the reference. That is what dropouts look like, so treat this"
  echo "   pass with suspicion and listen yourself:"
  echo "     reference: $REF_WAV"
  echo "     room:      $ROOM_WAV"
fi

echo
echo "✅ PASS — woke, held all ${#TURNS[@]} turns, and playback matched the reference."
exit 0
