package expo.modules.jarvisvolume

import android.content.Context
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.floor

/**
 * Keeps Jarvis from shouting on the wrist.
 *
 * Everything he says on a watch — the recorded greeting and the conversation after it — is call
 * audio, so it plays at the call volume, and a watch's call volume sits at or near the top of its
 * scale: loud enough to be heard across a room from a speaker the size of a fingernail, which is
 * exactly what a conversation on your wrist should not be. So before he speaks the call volume is
 * brought down to a share of its maximum, in the watch's own volume steps.
 *
 * Only ever down. A wearer who has turned it lower than that keeps it lower; one who turns it back
 * up mid-conversation keeps that too, until the next summoning.
 */
class JarvisVolumeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisVolume")

    // Resolves nothing and never throws: a volume that could not be lowered is a louder Jarvis, not
    // a broken one.
    Function("capCallVolume") { share: Double ->
      capCallVolume(context(), share)
    }
  }

  private fun capCallVolume(context: Context, share: Double) {
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    val stream = AudioManager.STREAM_VOICE_CALL
    val maximum = audioManager.getStreamMaxVolume(stream)
    val minimum = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) audioManager.getStreamMinVolume(stream) else 0
    // Rounded down, so a watch with few steps still comes down one rather than rounding back to
    // the top: 90% of five steps is four, not five.
    val capped = floor(maximum * share.coerceIn(0.0, 1.0)).toInt().coerceAtLeast(minimum)
    if (audioManager.getStreamVolume(stream) <= capped) {
      return
    }
    try {
      audioManager.setStreamVolume(stream, capped, 0)
    } catch (_: SecurityException) {
      // Do Not Disturb refusing a volume change: he is as loud as he was.
    }
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
