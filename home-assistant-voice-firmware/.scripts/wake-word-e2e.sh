#!/usr/bin/env bash
set -uo pipefail

# End-to-end acoustic test of the wake word AND the device's playback quality.
#
# Round trip, entirely over real air:
#   1. Synthesise "Hey Jarvis" with ElevenLabs TTS and play it through HOST speakers
#   2. Assert the Voice PE heard it, via micro_wake_word's serial log line
#   3. Speak a command so the agent replies
#   4. Stop playing, and record the ROOM with the host microphone — capturing the
#      device's own speaker
#   5. Send that recording to Gemini and ask whether the speech stutters
#
# Nothing is mocked: one run exercises TTS, the speakers, the room, the device
# microphone, the VAD, the wake word model, the agent, and the device's audio output.
#
# Step 5 exists because the device stutters as if buffering during playback. A room
# recording is the only way to judge what actually comes out of the speaker — serial
# logs cannot tell you how it sounds.
#
# The device must be physically near the host speakers and NOT muted. Check the
# HARDWARE mute switch on the back: it overrides the software one, and while it is on
# the wake word engine runs happily on a silent microphone, so nothing ever triggers.
#
# KNOWN LIMITATION: a passing run leaves a conversation open, and
# elevenlabs_stream.on_start stops the wake word engine until on_end. So a second run
# immediately after a pass will fail until that conversation finishes. Verified once
# (0.94 probability, first attempt); the immediate re-run failed, consistent with this
# but not confirmed on hardware. Either wait for the conversation to end, or teach the
# script to stop the stream before asserting.
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
#   COMMAND_TEXT       phrase asked after waking       (default "What time is it?")
#   RECORD_SECONDS     how long to record the reply    (default 20)
#   RECORD_SOURCE      PulseAudio capture source       (default RDPSource, the WSLg mic)
#   GEMINI_MODEL       model used for the analysis     (default gemini-flash-latest)
#   SKIP_AUDIO_CHECK   1 = wake word only, no recording or analysis
#   LISTEN_ONLY        1 = play nothing, just watch for a detection from live speech
#
# Exit codes:
#   0  woke, and the reply had no stuttering (or the check was skipped)
#   1  never woke
#   2  woke, but STUTTERING was detected in the reply
#   3  woke, but the reply could not be analysed (silent capture, or API failure)

WAKE_WORD_TEXT="${WAKE_WORD_TEXT:-Hey Jarvis}"
ATTEMPTS="${ATTEMPTS:-3}"
LISTEN_SECONDS="${LISTEN_SECONDS:-15}"
KEEP_AUDIO="${KEEP_AUDIO:-1}"

COMMAND_TEXT="${COMMAND_TEXT:-What time is it?}"
RECORD_SECONDS="${RECORD_SECONDS:-20}"
RECORD_SOURCE="${RECORD_SOURCE:-RDPSource}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-flash-latest}"

WORK_DIR="${TMPDIR:-/tmp}/hey-jarvis-wake-word-test"
mkdir -p "$WORK_DIR"
AUDIO_MP3="$WORK_DIR/wake-word.mp3"
AUDIO_WAV="$WORK_DIR/wake-word.wav"
COMMAND_MP3="$WORK_DIR/command.mp3"
COMMAND_WAV="$WORK_DIR/command.wav"
REPLY_WAV="$WORK_DIR/jarvis-reply.wav"
GEMINI_REQ="$WORK_DIR/gemini-request.json"
GEMINI_RES="$WORK_DIR/gemini-response.json"
SERIAL_LOG="$WORK_DIR/serial.log"

# Describe the artefact rather than naming it, and demand evidence. Asking "is it
# stuttering?" invites agreement; asking what it hears and requiring timestamps makes
# a false positive harder. Recording-side noise is called out explicitly so room echo
# or a quiet mic is not mistaken for a playback fault on the device.
ANALYSIS_PROMPT="${ANALYSIS_PROMPT:-This is a recording, made with a room microphone, of a smart speaker playing back synthesised speech.

Judge ONLY the playback quality of the speech, not its content and not the room.

Report stuttering_detected: true only if the SPEECH ITSELF is broken up — repeated
or re-articulated syllables, words chopped mid-utterance, abrupt gaps or dropouts
inside a word or phrase, or a robotic stammer. These indicate an audio buffering or
underrun fault in the device.

Report false if the speech is continuous and natural, even when it is quiet,
echoey, distant, or has background noise. Natural pauses between sentences, breaths
and ordinary hesitation are NOT stuttering.

Give a transcript of what is said. In evidence, quote the specific words affected
and where they occur, or state plainly that the speech was continuous. Put the
number of distinct artefacts in artifact_count. If you cannot hear intelligible
speech at all, report false and say so in evidence.}"

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

for tool in curl ffmpeg jq base64; do
  command -v "$tool" > /dev/null 2>&1 || fail "$tool is required. sudo apt-get install -y $tool"
done

# Recording source, unless the reply check is switched off.
if [ -z "${SKIP_AUDIO_CHECK:-}" ]; then
  if ffmpeg -hide_banner -sources pulse 2>&1 | grep -q "$RECORD_SOURCE"; then
    echo "   mic:     $RECORD_SOURCE"
  else
    echo "   ⚠️  Capture source '$RECORD_SOURCE' not listed. Available:"
    ffmpeg -hide_banner -sources pulse 2>&1 | sed 's/^/      /' | head -6
    echo "      Set RECORD_SOURCE=<name>, or SKIP_AUDIO_CHECK=1 to test the wake word only."
  fi
fi

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

play_file() {
  local f="$1"
  case "$PLAYER" in
    ffplay) ffplay -nodisp -autoexit -loglevel error "$f" > /dev/null 2>&1 ;;
    paplay) paplay "$f" > /dev/null 2>&1 ;;
    aplay) aplay -q "$f" > /dev/null 2>&1 ;;
    powershell)
      # Copy onto the Windows filesystem first: SoundPlayer is unreliable with the
      # \\wsl$ UNC path, and a local copy always works.
      local win_dir win_path
      win_dir="$(powershell.exe -NoProfile -Command 'Write-Host -NoNewline $env:TEMP' 2> /dev/null | tr -d '\r')"
      if [ -n "$win_dir" ]; then
        local lin_dir
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

# --- play and assert ---------------------------------------------------------
detected_line=""
woke=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "▶️  Attempt $attempt/$ATTEMPTS — playing through host speakers..."
  mark="$(wc -c < "$SERIAL_LOG")"
  play_file "$AUDIO_WAV"

  deadline=$((SECONDS + LISTEN_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # Only look at output produced since this attempt started.
    if detected_line="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m1 -E "$DETECT_RE")"; then
      echo
      echo "✅ Wake word detected."
      echo "   $detected_line"
      follow_up="$(tail -c "+$((mark + 1))" "$SERIAL_LOG" 2> /dev/null | grep -m3 -E "$STREAM_RE")"
      if [ -n "$follow_up" ]; then
        echo "   Follow-on activity:"
        printf '     %s\n' "$follow_up"
      else
        echo "   ⚠️  Wake word detected, but no ElevenLabs stream activity followed."
        echo "      Check that master_mute_switch is off and the device has WiFi."
      fi
      woke=1
      break 2
    fi
    sleep 1
  done
  echo "   no detection within ${LISTEN_SECONDS}s"
done

if [ "$woke" = "1" ]; then
  # --- capture Jarvis's reply ------------------------------------------------
  # The device is now listening. Speak a command so it actually replies, then stop
  # playing and record the room: the microphone hears the device's SPEAKER, which is
  # the only way to judge what the audio really sounds like coming out of it.
  #
  # Deliberately RDPSource (the real microphone) and not RDPSink.monitor, which is a
  # loopback of what this host plays and would just record our own TTS back.
  if [ -n "${SKIP_AUDIO_CHECK:-}" ]; then
    echo
    echo "⏭️  SKIP_AUDIO_CHECK set — not recording or analysing the reply."
    exit 0
  fi

  echo
  echo "🗣️  Asking: \"$COMMAND_TEXT\""
  if [ ! -s "$COMMAND_WAV" ]; then
    payload="$(jq -nc --arg text "$COMMAND_TEXT" \
      '{text: $text, model_id: "eleven_multilingual_v2"}')"
    http="$(call_elevenlabs "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" "$COMMAND_MP3" "$payload")"
    [ "$http" = "200" ] || fail "Could not synthesise the command (HTTP $http)."
    ffmpeg -loglevel error -y -i "$COMMAND_MP3" -ac 1 -ar 48000 -sample_fmt s16 "$COMMAND_WAV" \
      || fail "ffmpeg could not convert the command audio."
  fi

  play_file "$COMMAND_WAV"

  echo "🎙️  Recording the reply for ${RECORD_SECONDS}s from '${RECORD_SOURCE}'..."
  ffmpeg -hide_banner -loglevel error -y -f pulse -i "$RECORD_SOURCE" \
    -t "$RECORD_SECONDS" -ac 1 -ar 16000 -sample_fmt s16 "$REPLY_WAV" 2> /dev/null \
    || fail "Could not record from '$RECORD_SOURCE'. List sources: ffmpeg -sources pulse"

  rec_peak="$(ffmpeg -i "$REPLY_WAV" -af volumedetect -f null /dev/null 2>&1 \
    | grep -a -oE 'max_volume: -?[0-9.]+' | head -1 | grep -oE '\-?[0-9.]+')"
  echo "   captured: $REPLY_WAV (peak ${rec_peak:-?} dB)"

  # A silent capture means the microphone heard nothing — analysing it would produce
  # a confident-sounding verdict about silence, which is worse than saying so.
  if [ -n "$rec_peak" ] && awk -v p="$rec_peak" 'BEGIN { exit !(p < -45) }'; then
    echo
    echo "⚠️  The recording is effectively silent (peak ${rec_peak} dB)."
    echo "   Either the device never replied, or the host microphone cannot hear it."
    echo "   Not sending it for analysis — the verdict would be meaningless."
    exit 3
  fi

  # --- analyse for stuttering ------------------------------------------------
  [ -n "${HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY:-}" ] \
    || fail "HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY is not set; cannot analyse the audio."

  echo "🧠 Analysing with ${GEMINI_MODEL}..."
  jq -n --arg audio "$(base64 -w0 < "$REPLY_WAV")" --arg prompt "$ANALYSIS_PROMPT" '{
    contents: [ { parts: [ { text: $prompt }, { inline_data: { mime_type: "audio/wav", data: $audio } } ] } ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          stuttering_detected: { type: "BOOLEAN" },
          confidence: { type: "STRING", enum: ["low", "medium", "high"] },
          transcript: { type: "STRING" },
          evidence: { type: "STRING" },
          artifact_count: { type: "INTEGER" }
        },
        required: ["stuttering_detected", "confidence", "transcript", "evidence"]
      }
    }
  }' > "$GEMINI_REQ"

  # Key travels in a header via a stdin config file, never argv or the URL.
  printf 'header = "x-goog-api-key: %s"\n' "$HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY" \
    | curl -sS --config - -X POST \
      "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent" \
      -H 'Content-Type: application/json' --data-binary "@$GEMINI_REQ" -o "$GEMINI_RES"

  if ! verdict="$(jq -er '.candidates[0].content.parts[0].text' "$GEMINI_RES" 2> /dev/null)"; then
    echo "❌ Gemini did not return a verdict:" >&2
    head -c 600 "$GEMINI_RES" >&2; echo >&2
    exit 3
  fi

  stutter="$(printf '%s' "$verdict" | jq -r '.stuttering_detected')"
  echo
  echo "   transcript: $(printf '%s' "$verdict" | jq -r '.transcript')"
  echo "   confidence: $(printf '%s' "$verdict" | jq -r '.confidence')"
  echo "   evidence:   $(printf '%s' "$verdict" | jq -r '.evidence')"

  if [ "$stutter" = "true" ]; then
    echo
    echo "❌ STUTTERING DETECTED in Jarvis's speech."
    echo "   Recording kept at: $REPLY_WAV"
    exit 2
  fi

  echo
  echo "✅ PASS — woke on the wake word and replied without stuttering."
  exit 0
fi

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
