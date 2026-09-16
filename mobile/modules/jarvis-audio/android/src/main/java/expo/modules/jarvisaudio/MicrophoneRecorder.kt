package expo.modules.jarvisaudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlin.concurrent.thread

private const val TAG = "JarvisAudio"

/** What sample mode records at. A phone's microphone gives this natively; the analysis resamples. */
private const val SAMPLE_RATE = 48000

/** Read in chunks of about 20 ms, so the tap is never more than that behind the room. */
private const val CHUNK_SAMPLES = SAMPLE_RATE / 50

/**
 * The microphone, recorded directly, for sample mode.
 *
 * Sample mode used to borrow WebRTC's recorder — the one a conversation uses — because it was
 * already there and needed no connection. What that quietly brought with it was the audio
 * processing a call wants: the app configures LiveKit with `audioType: 'communication'`, so
 * Android puts the microphone in call mode with echo cancellation, noise suppression and
 * automatic gain, and WebRTC adds its own. Outside a call there is no far end for any of that
 * to reference, and it drives the input down hard. On the user's phone an ordinary speaking
 * voice arrived at about -54 dBFS — a perceived level of 0.08 where speech should read 0.3 to
 * 0.6, quiet enough that it never counted as speech at all and the sphere never stirred. Three
 * rounds of making the sphere answer more loudly could not fix a signal that was not there.
 *
 * So sample mode records for itself: `VOICE_RECOGNITION`, which is meant for capturing someone
 * talking rather than for holding a call, and leaves the level alone.
 *
 * A conversation still listens to Jarvis through WebRTC, which is right — that audio is already
 * inside WebRTC and never touches this.
 */
class MicrophoneRecorder(private val tap: AudioTap) {
  private var record: AudioRecord? = null
  private var reader: Thread? = null

  @Volatile
  private var isRunning = false

  /** Starts recording, or does nothing if it is already running. Throws if the microphone cannot be opened. */
  fun start() {
    if (isRunning) {
      return
    }
    val minimumBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimumBuffer <= 0) {
      throw IllegalStateException("This device will not record 48 kHz mono 16-bit audio.")
    }
    // Four chunks of headroom, so a slow reader loses nothing.
    val bufferBytes = maxOf(minimumBuffer, CHUNK_SAMPLES * 2 * 4)
    val opened = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      bufferBytes,
    )
    if (opened.state != AudioRecord.STATE_INITIALIZED) {
      opened.release()
      throw IllegalStateException("The microphone could not be opened.")
    }

    record = opened
    isRunning = true
    opened.startRecording()
    reader = thread(name = "jarvis-microphone", isDaemon = true) {
      val samples = ShortArray(CHUNK_SAMPLES)
      while (isRunning) {
        val read = opened.read(samples, 0, samples.size)
        if (read > 0) {
          tap.writeSamples(samples, read, SAMPLE_RATE)
        } else if (read < 0) {
          Log.w(TAG, "the microphone stopped giving samples: $read")
          break
        }
      }
    }
    Log.i(TAG, "microphone started, recording for itself at $SAMPLE_RATE Hz")
  }

  /** Stops recording and lets the microphone go, synchronously. */
  fun stop() {
    if (!isRunning) {
      return
    }
    isRunning = false
    reader?.join(500)
    reader = null
    record?.let {
      runCatching { it.stop() }
      it.release()
    }
    record = null
    Log.i(TAG, "microphone stopped")
  }
}
