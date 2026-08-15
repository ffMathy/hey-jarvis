#!/usr/bin/env bash
set -uo pipefail

# End-to-end acoustic test of the Voice PE: wake word, conversation, and playback
# fidelity — all over real air, nothing mocked.
#
#   1. Start recording the ROOM with the host microphone
#   2. Synthesise "Hey Jarvis" (ElevenLabs TTS) and play it through HOST speakers
#   3. Assert the device heard it, via micro_wake_word's serial log line
#   4. Speak a command so the agent replies
#   5. Keep recording until the device ends the conversation
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
#   COMMAND_TEXT       phrase asked after waking       (default "What time is it?")
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
#   KEEP_AUDIO         1 = reuse synthesised phrases between runs (default 1)
#
# Exit codes:
#   0  woke, and the playback matched the reference
#   1  never woke
#   2  woke, but the comparison found playback DEFECTS
#   3  woke, but the comparison could not run (silent capture, API or processing failure)

WAKE_WORD_TEXT="${WAKE_WORD_TEXT:-Hey Jarvis}"
COMMAND_TEXT="${COMMAND_TEXT:-What time is it?}"
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
COMMAND_MP3="$WORK_DIR/command.mp3"
COMMAND_WAV="$WORK_DIR/command.wav"
ROOM_RAW="$WORK_DIR/room-recording.wav"
ROOM_WAV="$WORK_DIR/room-16k.wav"
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

reader_pid=""
recorder_pid=""
cleanup() {
  [ -n "$reader_pid" ] && kill "$reader_pid" 2> /dev/null
  [ -n "$recorder_pid" ] && kill "$recorder_pid" 2> /dev/null
  [ "$KEEP_AUDIO" = "1" ] || rm -f "$AUDIO_MP3" "$AUDIO_WAV" "$COMMAND_MP3" "$COMMAND_WAV"
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
echo "   phrase:  \"$WAKE_WORD_TEXT\" then \"$COMMAND_TEXT\""

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
[ -n "${SKIP_AUDIO_CHECK:-}" ] || synthesise "$COMMAND_TEXT" "$COMMAND_MP3" "$COMMAND_WAV" "command"

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
if [ -z "${SKIP_AUDIO_CHECK:-}" ]; then
  echo "🎙️  Recording the room (max ${CONVERSATION_MAX}s)"
  ffmpeg -hide_banner -loglevel error -y -f pulse -i "$RECORD_SOURCE" \
    -t "$CONVERSATION_MAX" -ac 1 -ar 16000 -sample_fmt s16 "$ROOM_RAW" > /dev/null 2>&1 &
  recorder_pid=$!
  sleep 1
fi

# Epoch before anything happens, so the conversation lookup cannot match an older call.
started_at="$(date +%s)"

# --- wake the device ---------------------------------------------------------
detected_line=""
woke=0
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
echo "🗨️  Asking: \"$COMMAND_TEXT\""
play_file "$COMMAND_WAV"

echo "⏳ Waiting for the conversation to end (max ${CONVERSATION_MAX}s)..."
conv_mark="$(wc -c < "$SERIAL_LOG")"
deadline=$((SECONDS + CONVERSATION_MAX))
ended=0
while [ "$SECONDS" -lt "$deadline" ]; do
  # on_end restarts the wake word engine, so its start line marks the call finishing.
  if tail -c "+$((conv_mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -q -E "$END_RE"; then
    ended=1
    echo "   conversation ended after $((SECONDS - (deadline - CONVERSATION_MAX)))s"
    break
  fi
  sleep 1
done
[ "$ended" = "1" ] || echo "   ⚠️  No end-of-call marker; recording the full ${CONVERSATION_MAX}s window."

# Give the speaker a moment to finish, then stop recording.
sleep 2
kill "$recorder_pid" 2> /dev/null
wait "$recorder_pid" 2> /dev/null
recorder_pid=""

[ -s "$ROOM_RAW" ] || fail "Nothing was recorded from '$RECORD_SOURCE'."

room_peak="$(ffmpeg -i "$ROOM_RAW" -af volumedetect -f null /dev/null 2>&1 \
  | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
echo "   captured: $ROOM_RAW (peak ${room_peak:-?} dB)"

# A silent capture means the microphone heard nothing. Comparing it would produce a
# confident-sounding verdict about silence, which is worse than saying so.
if [ -n "$room_peak" ] && awk -v p="$room_peak" 'BEGIN { exit !(p < -45) }'; then
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
AUDIO 2 is a ROOM RECORDING made with a microphone, of a smart speaker playing that
same conversation out loud. Audio 2 also contains the human side of the conversation
played through separate speakers.

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
in defect_count. If the agent's speech is not audible at all in AUDIO 2, report false
and say so in differences.

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
base64 -w0 < "$REF_WAV" > "$WORK_DIR/ref.b64"
base64 -w0 < "$ROOM_WAV" > "$WORK_DIR/room.b64"

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
    { inline_data: { mime_type: "audio/wav", data: $ref } },
    { text: "AUDIO 2 — ROOM RECORDING (device speaker):" },
    { inline_data: { mime_type: "audio/wav", data: $room } }
  ] } ],
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        defects_found: { type: "BOOLEAN" },
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
echo "✅ PASS — woke on the wake word, and playback matched the reference."
exit 0
