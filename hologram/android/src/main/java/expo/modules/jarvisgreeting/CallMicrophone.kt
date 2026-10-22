package expo.modules.jarvisgreeting

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlin.concurrent.thread

private const val TAG = "JarvisCallMicrophone"

/** Any rate will do: nothing it records is kept. */
private const val SAMPLE_RATE = 16000

/**
 * The microphone opened the way a call opens it, `VOICE_COMMUNICATION`, while the greeting plays —
 * and everything it hears thrown away.
 *
 * **Why open a microphone only to ignore it.** The session dials behind the greeting, so WebRTC
 * opens the conversation's microphone partway through "Hello sir". On a phone's audio hardware a
 * call is a call-mode output *and* a call's input: until both are open, the call's audio is played
 * as ordinary output, at a volume the call volume does not govern; the moment WebRTC's input opens,
 * the hardware sets the call up and reroutes the output into it. Heard on a phone's speaker, that was
 * the greeting starting too loud, catching or cutting as the conversation connected, and finishing
 * at the call volume sir had set. Opened here before the greeting starts, the call is set up before
 * he speaks, and WebRTC's microphone joins an input already open, which changes nothing.
 *
 * It is let go when the greeting ends. By then WebRTC's own microphone holds the call open, or the
 * conversation is still connecting and nothing is playing for a switch to be heard in.
 *
 * Android 10 — every phone and watch the apps install on — lets one app record twice at once, so
 * this never takes the microphone from WebRTC or from `HeldVoice`.
 */
class CallMicrophone {
  private val lock = Any()
  private var recorder: AudioRecord? = null

  /**
   * Opens it, and returns once it is recording. Does nothing without the microphone permission, or
   * if it is already open: the greeting then plays as it did before this existed.
   */
  fun open(context: Context) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return
    }
    synchronized(lock) {
      if (recorder != null) {
        return
      }
    }
    val minimumBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimumBuffer <= 0) {
      return
    }
    val opened = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        minimumBuffer,
      )
    } catch (error: RuntimeException) {
      Log.w(TAG, "the microphone could not be opened ahead of the greeting", error)
      return
    }
    if (opened.state != AudioRecord.STATE_INITIALIZED) {
      opened.release()
      return
    }
    try {
      opened.startRecording()
    } catch (error: IllegalStateException) {
      opened.release()
      return
    }
    synchronized(lock) {
      recorder = opened
    }
    // Read and dropped, so the input is drained rather than overrunning for as long as it is open.
    thread(name = "jarvis-call-microphone", isDaemon = true) {
      val chunk = ShortArray(minimumBuffer / 2)
      try {
        while (synchronized(lock) { recorder === opened } && opened.read(chunk, 0, chunk.size) >= 0) {
          // Nothing kept.
        }
      } finally {
        runCatching { opened.stop() }
        opened.release()
      }
    }
  }

  /** Lets it go. Its thread stops recording once it sees this. */
  fun close() {
    synchronized(lock) {
      recorder = null
    }
  }
}
