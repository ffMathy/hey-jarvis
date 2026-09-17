package expo.modules.jarvisaudio

import org.webrtc.AudioTrackSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** About 340 ms at 48 kHz: more than one spectrum's worth at any rate a phone records at. */
private const val CAPACITY_SAMPLES = 16384

/**
 * Keeps the most recent audio that passes through it, as mono 16-bit samples,
 * for JavaScript to take whenever it wants a look.
 *
 * It is a WebRTC sink, so it can hang off either end of a conversation: the
 * microphone, through LiveKit's recorded-samples dispatcher, or a remote track —
 * Jarvis's voice — attached directly.
 *
 * The one thing it does differently from LiveKit's own processors is the thing
 * that matters: it says which byte order the samples are in. PCM on Android is
 * little-endian, but a `ByteBuffer` starts out big-endian — the dispatcher wraps
 * the recorded bytes with `ByteBuffer.wrap`, and WebRTC's native sink wrapper
 * sets no order either — and LiveKit's volume processor reads the buffer as it
 * comes. Setting the order here makes the reading right whichever order the
 * buffer arrived in.
 *
 * `onData` runs on WebRTC's audio thread, a hundred times a second, so it only
 * copies.
 */
class AudioTap : AudioTrackSink {
  private val ring = ShortArray(CAPACITY_SAMPLES)
  private var writeIndex = 0
  private var filled = 0

  /** The rate of the audio last seen, or 0 before any has arrived. */
  @Volatile
  var sampleRate = 0
    private set

  /** Every frame ever seen, for a log line that proves audio is flowing. */
  @Volatile
  var framesSeen = 0L
    private set

  override fun onData(
    audioData: ByteBuffer,
    bitsPerSample: Int,
    sampleRate: Int,
    numberOfChannels: Int,
    numberOfFrames: Int,
    absoluteCaptureTimestampMs: Long,
  ) {
    if (bitsPerSample != 16 || numberOfChannels < 1) {
      return
    }

    // A duplicate, so neither the position nor the order of a buffer another sink
    // might also be reading is disturbed.
    val samples = audioData.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    samples.position(0)
    val frames = minOf(numberOfFrames, samples.remaining() / (2 * numberOfChannels))

    synchronized(ring) {
      for (frame in 0 until frames) {
        var sum = 0
        for (channel in 0 until numberOfChannels) {
          sum += samples.getShort()
        }
        ring[writeIndex] = (sum / numberOfChannels).toShort()
        writeIndex = (writeIndex + 1) % CAPACITY_SAMPLES
      }
      filled = minOf(CAPACITY_SAMPLES, filled + frames)
      this.sampleRate = sampleRate
      framesSeen += frames
    }
  }

  /**
   * The latest `count` samples, oldest first, as 16-bit little-endian bytes —
   * which reach JavaScript as a `Uint8Array`. Fewer if fewer have arrived.
   */
  fun copyLatest(count: Int): ByteArray {
    synchronized(ring) {
      val available = minOf(count.coerceAtLeast(0), filled)
      val bytes = ByteBuffer.allocate(available * 2).order(ByteOrder.LITTLE_ENDIAN)
      val start = (writeIndex - available + CAPACITY_SAMPLES) % CAPACITY_SAMPLES
      for (offset in 0 until available) {
        bytes.putShort(ring[(start + offset) % CAPACITY_SAMPLES])
      }
      return bytes.array()
    }
  }

  /**
   * Adds `count` mono 16-bit samples read straight from a recorder, rather than
   * handed over by WebRTC. Same ring, same reader on the JavaScript side.
   */
  fun writeSamples(samples: ShortArray, count: Int, sampleRate: Int) {
    synchronized(ring) {
      for (index in 0 until count) {
        ring[writeIndex] = samples[index]
        writeIndex = (writeIndex + 1) % CAPACITY_SAMPLES
      }
      filled = minOf(CAPACITY_SAMPLES, filled + count)
      this.sampleRate = sampleRate
      framesSeen += count
    }
  }

  /** Forgets everything, so a new source never starts with the last one's tail. */
  fun clear() {
    synchronized(ring) {
      writeIndex = 0
      filled = 0
      sampleRate = 0
    }
  }
}
