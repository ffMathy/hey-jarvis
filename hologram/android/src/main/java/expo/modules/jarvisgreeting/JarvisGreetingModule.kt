package expo.modules.jarvisgreeting

import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
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
