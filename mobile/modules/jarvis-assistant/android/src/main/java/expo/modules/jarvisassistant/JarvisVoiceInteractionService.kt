package expo.modules.jarvisassistant

import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.util.Log
import java.lang.ref.WeakReference

/**
 * The long-lived service the system binds to while Jarvis holds the assistant
 * role. It is what makes the app selectable in Settings under "Digital
 * assistant app", which is the whole point of this module.
 *
 * It has nothing to do on its own: Jarvis does not run a hotword detector —
 * the house already listens through the voice firmware, and a phone that
 * listened too would only add a second microphone to an already-answered
 * question. The work happens in the session, once the user has actually
 * summoned it.
 *
 * The one thing it is asked for besides is to summon him from somewhere other
 * than the phone's own gesture: the watch, when the phone has earbuds in and
 * the watch's speaker would only broadcast the conversation. See
 * `JarvisWatchSummonService`. `showSession` is the supported way for an
 * assistant to open its own window, and only the active service may call it,
 * which is why the service keeps a note of itself while it is the one.
 */
class JarvisVoiceInteractionService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    active = WeakReference(this)
  }

  override fun onShutdown() {
    if (active?.get() === this) {
      active = null
    }
    super.onShutdown()
  }

  companion object {
    private const val TAG = "JarvisAssistant"

    /** The service while Jarvis is the chosen assistant, and null while he is not. */
    @Volatile private var active: WeakReference<JarvisVoiceInteractionService>? = null

    /**
     * Opens the assistant's window exactly as the phone's own gesture would. Main thread only.
     * False when Jarvis is not the assistant, or the system refused.
     */
    internal fun summon(): Boolean {
      val service = active?.get() ?: return false
      return try {
        service.showSession(Bundle(), 0)
        true
      } catch (error: RuntimeException) {
        Log.w(TAG, "Could not open the assistant's window for the watch.", error)
        false
      }
    }

    /** Puts the window away again, for a summoning the watch has stopped waiting for. */
    internal fun unsummon() {
      try {
        active?.get()?.hideSession()
      } catch (error: RuntimeException) {
        Log.w(TAG, "Could not put the assistant's window away.", error)
      }
    }
  }
}
