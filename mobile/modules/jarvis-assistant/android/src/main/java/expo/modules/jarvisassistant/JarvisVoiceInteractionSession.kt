package expo.modules.jarvisassistant

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.util.Log

/**
 * What actually happens when the user summons Jarvis.
 *
 * A voice interaction session owns a window of its own, drawn by the system on
 * top of whatever the user was doing. React Native cannot render into it, so
 * rather than building a second, native version of the conversation screen, the
 * session does the one thing it is uniquely able to do — open the app in the
 * assistant's own task — and then gets out of the way.
 *
 * From the user's side that is indistinguishable from an assistant that draws
 * its own overlay, except that what comes up is the real app with the real
 * conversation in it.
 */
class JarvisVoiceInteractionSession(context: Context) : VoiceInteractionSession(context) {

  /**
   * Stops the system creating a window for a session that has nothing to draw.
   *
   * Without it there is an empty assistant window in front of the app for a
   * frame or two on every summoning. It has to happen here, before the session
   * is shown, because that is when the window would otherwise be created — and
   * once it is off, nothing may ask for a content view afterwards.
   *
   * This does not stop the session counting as shown, which is what
   * {@link startAssistantActivity} actually requires; that flag is set by the
   * system when it decides to show the session, before any of this runs.
   */
  override fun onPrepareShow(args: Bundle?, showFlags: Int) {
    super.onPrepareShow(args, showFlags)
    setUiEnabled(false)
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    showConversation()
    // Strictly after the start above. Hiding first would retract the session
    // while the activity start is still being authorised against it.
    hide()
  }

  private fun showConversation() {
    val intent = createAssistIntent(context.packageName)

    // `startAssistantActivity` places the activity in the assistant's own task,
    // which is what lets it come up over whatever the user summoned Jarvis from.
    // It exists from API 26, and it throws if the session has already been
    // retracted — and a summoning that silently opens nothing is the worst
    // outcome here, so a plain launch is kept behind it. That fallback is legal
    // from a session running in the background, because the system holds this
    // service bound with BIND_ALLOW_BACKGROUND_ACTIVITY_STARTS for as long as
    // Jarvis is the assistant.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        startAssistantActivity(intent)
        return
      } catch (error: RuntimeException) {
        Log.w(TAG, "Could not start the conversation in the assistant task; falling back.", error)
      }
    }

    try {
      context.startActivity(intent)
    } catch (error: RuntimeException) {
      Log.e(TAG, "Could not open Jarvis in response to an assist gesture.", error)
    }
  }

  private companion object {
    const val TAG = "JarvisAssistant"
  }
}
