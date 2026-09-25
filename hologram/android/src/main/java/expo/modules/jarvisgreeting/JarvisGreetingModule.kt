package expo.modules.jarvisgreeting

import android.content.BroadcastReceiver
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Plays Jarvis's recorded greeting as call audio rather than as media.
 *
 * expo-audio plays through ExoPlayer with the default attributes, `USAGE_MEDIA`, and on a phone that
 * was not heard: not on its own, and not inside LiveKit's audio session started before it either.
 * So the greeting is played here instead, with the attributes a call's own audio has —
 * `USAGE_VOICE_COMMUNICATION`, `CONTENT_TYPE_SPEECH` — which puts it on the stream, the route and
 * the volume that Jarvis's voice uses a moment later when the conversation takes over.
 *
 * A plain `MediaPlayer`, because a 27 KB recording played once per summoning needs nothing more, and
 * it keeps this module free of dependencies. It asks for no audio focus: the call's audio session,
 * started before this plays, already holds it.
 */
/**
 * How long past the headset's call audio reporting itself connected before the greeting starts.
 *
 * "Connected" is when the Bluetooth link is up, not when a headset is audibly playing through it,
 * and AirPods were heard to clip the first word when played into straight away. This is a margin
 * picked by ear rather than measured; raise it if the start is still clipped.
 */
private const val SETTLE_AFTER_CONNECTED_MS = 250L

/** How often a Bluetooth LE Audio headset is checked for having become the call's route. */
private const val LOOK_EVERY_MS = 100L

class JarvisGreetingModule : Module() {
  private val lock = Any()
  private var player: MediaPlayer? = null
  /** What `player` was prepared from, so a second summoning reuses it rather than loading it again. */
  private var preparedFrom: String? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("JarvisGreeting")

    /**
     * Plays the recording at `source` from the start, and resolves once it is playing.
     *
     * `source` is what React Native resolves the bundled asset to: a Metro URL in a development
     * build, and a raw resource's name in a release one. Rejects if it cannot be loaded, so the
     * caller can let the agent greet in its own voice instead.
     */
    AsyncFunction("play") { source: String ->
      synchronized(lock) {
        val ready = playerFor(source)
        ready.seekTo(0)
        ready.start()
      }
    }

    /**
     * Resolves once the call's audio can actually be heard on the Bluetooth headset it is routed to
     * — true — or at once, false, when there is no Bluetooth headset to wait for.
     *
     * AirPods and every other headset carry a call over a different link from music (the headset
     * profile, SCO, rather than A2DP), and bringing that link up after the call's audio session has
     * asked for it takes a moment. Played into before it is up, the first word of the greeting was
     * lost. So this waits for Android to say the link is connected — the sticky
     * `ACTION_SCO_AUDIO_STATE_UPDATED` broadcast, or for an LE Audio headset its becoming the
     * communication device — and gives up after `timeoutMs`, resolving false, rather than keep
     * him silent for a headset that never answers.
     */
    AsyncFunction("untilCallRouteReady") { timeoutMs: Int, promise: Promise ->
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (!hasBluetoothCallHeadset(audioManager)) {
        promise.resolve(false)
        return@AsyncFunction
      }
      CallRouteWait(context, audioManager, timeoutMs.toLong(), promise).start()
    }

    Function("pause") {
      synchronized(lock) {
        player?.takeIf { it.isPlaying }?.pause()
      }
    }

    /** Whether it is audibly playing right now. */
    Function("isPlaying") {
      synchronized(lock) { player?.isPlaying ?: false }
    }

    /** Where it is in the recording, in seconds. */
    Function("currentTime") {
      synchronized(lock) { (player?.currentPosition ?: 0) / 1000.0 }
    }

    /** How long the recording is, in seconds, or 0 before it has been loaded. */
    Function("duration") {
      synchronized(lock) { player?.duration?.takeIf { it > 0 }?.div(1000.0) ?: 0.0 }
    }

    OnDestroy {
      synchronized(lock) {
        player?.release()
        player = null
        preparedFrom = null
      }
    }
  }

  /** Whether a headset that can carry a call — Bluetooth Classic or LE Audio — is connected. */
  private fun hasBluetoothCallHeadset(audioManager: AudioManager): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return audioManager.availableCommunicationDevices.any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
      }
    }
    return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
    }
  }

  private fun playerFor(source: String): MediaPlayer {
    val existing = player
    if (existing != null && preparedFrom == source) {
      return existing
    }
    existing?.release()
    player = null
    preparedFrom = null

    val prepared = MediaPlayer().apply {
      setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      setDataSource(context, uriFor(source))
      prepare()
    }
    player = prepared
    preparedFrom = source
    return prepared
  }

  /**
   * A development build serves the asset from Metro, with a scheme. A release build embeds it as a
   * raw resource and names it without one — the same distinction expo-audio draws.
   */
  private fun uriFor(source: String): Uri {
    val parsed = Uri.parse(source)
    if (parsed.scheme != null) {
      return parsed
    }
    val resourceId = context.resources.getIdentifier(source, "raw", context.packageName)
    require(resourceId != 0) { "No raw resource named $source" }
    return Uri.Builder()
      .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
      .authority(context.packageName)
      .appendPath(resourceId.toString())
      .build()
  }
}

/**
 * One wait for a headset's call audio, settled exactly once: connected, or timed out. Runs on the
 * main thread, where the broadcast is delivered, so settling needs no lock.
 */
private class CallRouteWait(
  private val context: Context,
  private val audioManager: AudioManager,
  private val timeoutMs: Long,
  private val promise: Promise,
) {
  private val handler = Handler(Looper.getMainLooper())
  private var settled = false

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(receivedContext: Context, intent: Intent) {
      val state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR)
      if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
        settle(ready = true)
      }
    }
  }

  private val lookForLeAudio = object : Runnable {
    override fun run() {
      if (settled) {
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        audioManager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLE_HEADSET
      ) {
        settle(ready = true)
        return
      }
      handler.postDelayed(this, LOOK_EVERY_MS)
    }
  }

  fun start() {
    handler.post {
      val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
      // A system broadcast, and a sticky one: if the link is already up, it arrives at once.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        context.registerReceiver(receiver, filter)
      }
      handler.post(lookForLeAudio)
      handler.postDelayed({ settle(ready = false) }, timeoutMs)
    }
  }

  private fun settle(ready: Boolean) {
    if (settled) {
      return
    }
    settled = true
    handler.removeCallbacksAndMessages(null)
    runCatching { context.unregisterReceiver(receiver) }
    if (ready) {
      handler.postDelayed({ promise.resolve(true) }, SETTLE_AFTER_CONNECTED_MS)
    } else {
      promise.resolve(false)
    }
  }
}
