package expo.modules.jarvisaudio

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactContext
import com.oney.WebRTCModule.WebRTCModule
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.webrtc.AudioTrack
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.sqrt

private const val TAG = "JarvisAudio"

/** How often a line is logged while audio flows: every this many seconds of audio. */
private const val LOG_EVERY_SECONDS = 0.5

/**
 * Raw audio for the hologram, from the microphone or from Jarvis.
 *
 * Two sources, one at a time, both feeding the same [AudioTap]:
 *
 * - **The microphone**, for sample mode, when there is no conversation to listen
 *   to. It records for itself through [MicrophoneRecorder] rather than borrowing
 *   WebRTC's recorder as it used to — see that class for the 25x of signal the
 *   borrowing was quietly costing.
 * - **A remote track**, Jarvis's voice in a live conversation, found by its peer
 *   connection and track ids the way LiveKit finds tracks for its own processors.
 *
 * JavaScript pulls from the tap on its own clock rather than being pushed events:
 * a hundred bridge events a second would cost more than the analysis they feed.
 */
class JarvisAudioModule : Module() {
  private val tap = AudioTap()
  private val microphone = MicrophoneRecorder(tap)
  private var isRecording = false
  private var tappedTrack: AudioTrack? = null
  private var framesLogged = 0L

  override fun definition() = ModuleDefinition {
    Name("JarvisAudio")

    // Synchronous, like stopping: starting takes milliseconds, and a start still
    // running on another thread when the screen unmounts would open the
    // microphone after it had been told to close.
    Function("startMicrophone") {
      startMicrophone()
    }

    Function("stopMicrophone") {
      stopMicrophone()
    }

    Function("listenToTrack") { peerConnectionId: Int, trackId: String ->
      listenToTrack(peerConnectionId, trackId)
    }

    Function("stopListeningToTrack") {
      stopListeningToTrack()
    }

    Function("sampleRate") {
      tap.sampleRate
    }

    Function("readLatest") { sampleCount: Int ->
      logFlow()
      tap.copyLatest(sampleCount)
    }

    OnDestroy {
      stopMicrophone()
      stopListeningToTrack()
    }
  }

  private fun startMicrophone() {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      // Checked here because WebRTC's recorder asserts on it, and an assertion is
      // an `Error`, not an exception JavaScript would be told about.
      throw CodedException("ERR_MICROPHONE_PERMISSION", "The microphone permission has not been granted.", null)
    }
    if (isRecording) {
      return
    }

    stopListeningToTrack()
    tap.clear()
    try {
      microphone.start()
    } catch (error: Throwable) {
      throw CodedException("ERR_MICROPHONE_START", "The microphone could not be started.", error)
    }
    isRecording = true
  }

  private fun stopMicrophone() {
    if (!isRecording) {
      return
    }
    isRecording = false
    runCatching { microphone.stop() }
    tap.clear()
  }

  private fun listenToTrack(peerConnectionId: Int, trackId: String) {
    val reactContext = appContext.reactContext as? ReactContext ?: throw Exceptions.ReactContextLost()
    val webRtc = reactContext.getNativeModule(WebRTCModule::class.java)
      ?: throw CodedException("ERR_WEBRTC_UNAVAILABLE", "WebRTC is not available in this build.", null)
    val track = webRtc.getTrack(peerConnectionId, trackId) as? AudioTrack
      ?: throw CodedException("ERR_TRACK_NOT_FOUND", "No audio track $trackId on connection $peerConnectionId.", null)

    stopMicrophone()
    stopListeningToTrack()
    tap.clear()
    track.addSink(tap)
    tappedTrack = track
    Log.i(TAG, "listening to track $trackId on connection $peerConnectionId")
  }

  private fun stopListeningToTrack() {
    val track = tappedTrack ?: return
    tappedTrack = null
    // The track may already have been disposed with its connection, which throws.
    runCatching { track.removeSink(tap) }
    tap.clear()
  }

  /**
   * A line in logcat now and then while audio flows, with the loudness of the
   * last 40 ms: what a device check compares against the signal it fed in, and
   * so the proof that the bytes are read in the right order.
   */
  private fun logFlow() {
    val frames = tap.framesSeen
    val sampleRate = tap.sampleRate
    if (sampleRate <= 0 || frames - framesLogged < sampleRate * LOG_EVERY_SECONDS) {
      return
    }
    framesLogged = frames
    val recent = ByteBuffer.wrap(tap.copyLatest(sampleRate / 25)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val count = recent.remaining()
    var sumOfSquares = 0.0
    for (index in 0 until count) {
      val sample = recent.get(index) / 32768.0
      sumOfSquares += sample * sample
    }
    val rms = if (count > 0) sqrt(sumOfSquares / count) else 0.0
    Log.i(TAG, "audio flowing: $sampleRate Hz, $frames frames, rms ${"%.4f".format(Locale.ROOT, rms)}")
  }
}
