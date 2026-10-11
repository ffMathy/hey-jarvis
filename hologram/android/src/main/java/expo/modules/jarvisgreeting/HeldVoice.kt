package expo.modules.jarvisgreeting

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.processing.AudioProcessorInterface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread
import kotlin.math.sqrt

private const val TAG = "JarvisHeldVoice"

/** What the microphone is kept at before WebRTC has it. Resampled to WebRTC's rate on handing over. */
private const val HOLD_SAMPLE_RATE = 48000

/** Read in chunks of 10 ms, WebRTC's own frame, so the hand-over overlaps by no more than that. */
private const val HOLD_CHUNK_SAMPLES = HOLD_SAMPLE_RATE / 100

/**
 * The most that is kept. Longer than the twenty seconds a summoning waits for its conversation
 * (`GIVE_UP_CONNECTING_AFTER_MS`), so it is never what cuts sir off; it only bounds the memory.
 */
private const val MOST_HELD_SECONDS = 30

/**
 * How long a pause is kept before the rest of it is skipped while the conversation is behind. Long
 * enough that words keep their spacing and a sentence still sounds like one; short enough that the
 * lateness goes in the first few pauses.
 */
private const val PAUSE_KEPT_MS = 200

/**
 * Below this a frame counts as a pause: about -45 dBFS, in WebRTC's 16-bit float scale. Above
 * background hiss and below any word — and a mistake either way is mild: too low and the
 * conversation stays late a little longer; too high and the quietest syllable of a long pause goes.
 */
private const val QUIET_RMS = 180f

/**
 * The most the conversation may stay behind. Past it, whatever is still queued is dropped and the
 * live microphone goes straight through, so a room too loud to ever count as a pause cannot keep
 * the agent hearing sir late for the whole conversation.
 */
private const val MOST_BEHIND_SECONDS = 20

/**
 * What sir says while a phone or a watch connects to Jarvis, kept and then played into the
 * conversation's own microphone track ahead of the live microphone.
 *
 * **Why inside the track.** On a device the ElevenLabs SDK talks to its agent over WebRTC only, and
 * the agent hears only what passes through the microphone track it publishes — the SDK drops audio
 * handed to it as messages over a room. So this is LiveKit's capture post-processor
 * (`AudioProcessingController.capturePostProcessor`): WebRTC hands it every 10 ms of the microphone,
 * after its own echo cancelling and before encoding, as a direct view of the frame, and whatever it
 * leaves there is what is sent.
 *
 * **The life of one summoning.**
 *
 * 1. `hold` — the greeting is over, nothing is listening yet. The microphone is recorded here, with
 *    an `AudioRecord` of its own, since WebRTC does not open it until the room's signal is up.
 * 2. The first frame WebRTC records — its microphone has opened, as the room connects. Recording
 *    here stops, and everything kept is resampled to WebRTC's rate and queued. From now on every
 *    live frame joins the back of the queue, and silence goes out in its place: the room is up, but
 *    the conversation is not listening, and anything heard now would be lost again.
 * 3. `release` — the agent is listening. Each frame now sends the front of the queue and queues the
 *    live one behind it, so sir is heard in order and late. While late, a pause longer than
 *    `PAUSE_KEPT_MS` is skipped rather than sent, which is how the lateness is worked off; once the
 *    queue is empty the live frame goes straight through and this steps aside until the next `hold`.
 * 4. `drop` — the summoning ended. Whatever is still kept or queued is forgotten.
 *
 * **The frame's format.** LiveKit's WebRTC hands over channel 0 of WebRTC's `AudioBuffer`: 10 ms of
 * 32-bit floats in WebRTC's 16-bit scale (±32768), in the device's byte order, at the rate WebRTC
 * processes at (`numFrames × 100`). The kept audio is 16-bit, so it is that scale already.
 *
 * `processAudio` runs on WebRTC's audio thread a hundred times a second, so it only copies, under a
 * lock held for no longer than that.
 */
class HeldVoice : AudioProcessorInterface {
  private val lock = Any()

  /** Between `hold` and caught up or dropped: whether WebRTC's frames are this class's to touch. */
  private var active = false

  /** Whether the agent is listening, so the queue may be sent. */
  private var released = false

  /** What the microphone gave before WebRTC had it, at `HOLD_SAMPLE_RATE`. */
  private var kept = ShortArray(HOLD_SAMPLE_RATE)
  private var keptCount = 0

  /** Whether WebRTC's own microphone has taken over, which is what stops recording here. */
  private var handedOver = false

  /** What is still to be sent, oldest first, at `queueRate`. */
  private val queue = FloatQueue()
  private var queueRate = 0

  /** How much of the current pause has been sent, in samples at `queueRate`. */
  private var pauseSent = 0

  private var recorder: AudioRecord? = null

  /**
   * Starts keeping the microphone, and puts this in WebRTC's path. Does nothing without the
   * microphone permission, or where LiveKit has set up no audio processing — what is said while
   * he connects is then lost, as it always was.
   */
  fun hold(context: Context) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return
    }
    val controller = try {
      LiveKitReactNative.audioProcessingController
    } catch (error: IllegalStateException) {
      Log.w(TAG, "LiveKit has no audio processing to hold the voice in", error)
      return
    }
    synchronized(lock) {
      forget()
      active = true
    }
    if (controller.capturePostProcessor !== this) {
      controller.capturePostProcessor = this
    }
    startRecording()
  }

  /** The agent is listening: the queue may go. */
  fun release() {
    synchronized(lock) {
      released = true
    }
  }

  /** The summoning is over: forget everything, and let the microphone go. */
  fun drop() {
    synchronized(lock) {
      forget()
    }
  }

  /** Under `lock`. Stops the recorder, whose thread lets the microphone go once it sees this. */
  private fun forget() {
    active = false
    released = false
    handedOver = false
    keptCount = 0
    queue.clear()
    queueRate = 0
    pauseSent = 0
    recorder = null
  }

  private fun startRecording() {
    val minimumBuffer = AudioRecord.getMinBufferSize(HOLD_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimumBuffer <= 0) {
      Log.w(TAG, "this device will not record $HOLD_SAMPLE_RATE Hz mono 16-bit audio")
      return
    }
    val opened = try {
      // Not the call's own source, `VOICE_COMMUNICATION`: in call mode Android drives that down to
      // about -54 dBFS and leaves WebRTC's gain control to bring it back up, and this is handed in
      // after that gain control — so it would reach the agent nearly silent, and read here as a
      // pause. `VOICE_RECOGNITION` leaves the level alone (see the phone's `MicrophoneRecorder`), and
      // with the greeting over there is no echo of him for a call's processing to take out.
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        HOLD_SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minimumBuffer, HOLD_CHUNK_SAMPLES * 2 * 8),
      )
    } catch (error: RuntimeException) {
      Log.w(TAG, "the microphone could not be opened to hold the voice", error)
      return
    }
    if (opened.state != AudioRecord.STATE_INITIALIZED) {
      opened.release()
      return
    }
    synchronized(lock) {
      if (!active) {
        opened.release()
        return
      }
      recorder = opened
    }
    opened.startRecording()
    thread(name = "jarvis-held-voice", isDaemon = true) {
      val chunk = ShortArray(HOLD_CHUNK_SAMPLES)
      try {
        while (true) {
          val read = opened.read(chunk, 0, chunk.size)
          val keeping = synchronized(lock) {
            if (recorder !== opened || handedOver) {
              false
            } else {
              if (read > 0) {
                keep(chunk, read)
              }
              read >= 0 && keptCount < HOLD_SAMPLE_RATE * MOST_HELD_SECONDS
            }
          }
          if (!keeping) {
            break
          }
        }
      } finally {
        runCatching { opened.stop() }
        opened.release()
      }
    }
  }

  /** Under `lock`. */
  private fun keep(chunk: ShortArray, count: Int) {
    if (keptCount + count > kept.size) {
      kept = kept.copyOf(maxOf(kept.size * 2, keptCount + count))
    }
    System.arraycopy(chunk, 0, kept, keptCount, count)
    keptCount += count
  }

  override fun isEnabled() = true

  override fun getName() = "JarvisHeldVoice"

  override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) = Unit

  /** WebRTC's rate changed under a queue kept at the old one: send the live microphone as it is. */
  override fun resetAudioProcessing(newRate: Int) {
    synchronized(lock) {
      if (handedOver && queueRate != newRate) {
        forget()
      }
    }
  }

  override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
    synchronized(lock) {
      if (!active) {
        return
      }
      val frame = buffer.duplicate().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val samples = minOf(numFrames, frame.capacity())
      if (samples <= 0) {
        return
      }
      if (!handedOver) {
        handOver(samples * 100)
      }
      queue.pushFrom(frame, samples)
      if (!released) {
        for (index in 0 until samples) {
          frame.put(index, 0f)
        }
        return
      }
      catchUp(samples)
      queue.popInto(frame, samples)
      if (queue.size == 0) {
        Log.i(TAG, "caught up: the conversation hears the microphone as it is")
        forget()
      }
    }
  }

  /** Under `lock`. WebRTC has the microphone now: queue what was kept, at WebRTC's rate. */
  private fun handOver(rate: Int) {
    handedOver = true
    recorder = null
    queueRate = rate
    queue.pushResampled(kept, keptCount, HOLD_SAMPLE_RATE, rate)
    Log.i(TAG, "handing over ${keptCount * 1000L / HOLD_SAMPLE_RATE} ms kept while connecting")
    keptCount = 0
    kept = ShortArray(HOLD_SAMPLE_RATE)
  }

  /**
   * Under `lock`, with the live frame already queued. Skips what is left of each pause beyond
   * `PAUSE_KEPT_MS` — never the live frame itself — and gives up on being behind past
   * `MOST_BEHIND_SECONDS`.
   */
  private fun catchUp(frameSamples: Int) {
    if (queue.size - frameSamples > queueRate * MOST_BEHIND_SECONDS) {
      Log.w(TAG, "too far behind: dropping what is still queued")
      queue.skip(queue.size - frameSamples)
      return
    }
    val pauseKept = queueRate * PAUSE_KEPT_MS / 1000
    while (queue.size > frameSamples && pauseSent >= pauseKept && queue.frontRms(frameSamples) < QUIET_RMS) {
      queue.skip(frameSamples)
    }
    pauseSent = if (queue.frontRms(frameSamples) < QUIET_RMS) pauseSent + frameSamples else 0
  }
}

/** A queue of samples: pushed at the back, taken from the front, without reallocating every frame. */
private class FloatQueue {
  private var samples = FloatArray(48000)
  private var start = 0
  private var end = 0

  val size: Int
    get() = end - start

  fun clear() {
    start = 0
    end = 0
  }

  private fun makeRoom(count: Int) {
    if (end + count <= samples.size) {
      return
    }
    val held = size
    val grown = if (held + count > samples.size) FloatArray(maxOf(samples.size * 2, held + count)) else samples
    System.arraycopy(samples, start, grown, 0, held)
    samples = grown
    start = 0
    end = held
  }

  fun pushFrom(frame: java.nio.FloatBuffer, count: Int) {
    makeRoom(count)
    for (index in 0 until count) {
      samples[end + index] = frame.get(index)
    }
    end += count
  }

  /** Pushes 16-bit audio at `fromRate` as `toRate`, by linear interpolation. */
  fun pushResampled(source: ShortArray, count: Int, fromRate: Int, toRate: Int) {
    if (count <= 0) {
      return
    }
    val produced = (count.toLong() * toRate / fromRate).toInt()
    makeRoom(produced)
    val step = fromRate.toDouble() / toRate
    for (index in 0 until produced) {
      val position = index * step
      val before = position.toInt().coerceAtMost(count - 1)
      val after = (before + 1).coerceAtMost(count - 1)
      val fraction = (position - before).toFloat()
      samples[end + index] = source[before] + (source[after] - source[before]) * fraction
    }
    end += produced
  }

  /** Takes `count` from the front into the frame, clamped to what WebRTC's 16-bit scale can carry. */
  fun popInto(frame: java.nio.FloatBuffer, count: Int) {
    for (index in 0 until count) {
      frame.put(index, samples[start + index].coerceIn(-32768f, 32767f))
    }
    start += count
    if (start == end) {
      clear()
    }
  }

  fun skip(count: Int) {
    start += minOf(count, size)
    if (start == end) {
      clear()
    }
  }

  /** How loud the first `count` samples are. */
  fun frontRms(count: Int): Float {
    val available = minOf(count, size)
    if (available <= 0) {
      return 0f
    }
    var sumOfSquares = 0.0
    for (index in start until start + available) {
      sumOfSquares += samples[index] * samples[index]
    }
    return sqrt(sumOfSquares / available).toFloat()
  }
}
