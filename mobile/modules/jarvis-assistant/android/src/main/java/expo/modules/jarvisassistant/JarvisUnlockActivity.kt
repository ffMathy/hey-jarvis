package expo.modules.jarvisassistant

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.os.Bundle
import android.util.Log

/**
 * Asks sir to unlock the phone, and summons Jarvis once he has.
 *
 * **Summoned on a locked phone, Jarvis used to start behind the lock screen.** Holding the power
 * button reaches the assistant whether or not the phone is locked, and the session's window drew the
 * app and started a conversation as usual — but under the keyguard, where nobody could see it: sir
 * heard "Hello sir, how can I help?" and then nothing, with no sheet to talk to or hang up with. And
 * a conversation that had gone on would have answered whoever was holding the phone, which is why
 * `supportsLaunchVoiceAssistFromKeyguard` is false: Jarvis runs the house.
 *
 * So a summoning on a locked phone starts this instead (`JarvisVoiceInteractionSession.onShow`), and
 * it does what an activity can and a voice interaction session cannot: `requestDismissKeyguard`,
 * which brings up the fingerprint, face or PIN prompt over the lock screen, or simply swipes away a
 * lock screen with no credential. Unlocked, the assistant's window is opened again, exactly as the
 * gesture would have opened it on an unlocked phone. Turned down, nothing opens.
 *
 * It draws nothing — the keyguard's own prompt is the whole of it — and it is shown over the lock
 * screen (`showWhenLocked` in the manifest), since that is the only place it ever runs. No task
 * affinity, for the same reason as `JarvisPhotoActivity`: it must never bring the app's own activity
 * forward behind it.
 */
class JarvisUnlockActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Recreated while the prompt is up — a rotation — the request made the first time still stands.
    if (savedInstanceState != null) {
      return
    }

    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (keyguard == null || !keyguard.isKeyguardLocked) {
      summonJarvis()
      return
    }

    keyguard.requestDismissKeyguard(
      this,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          summonJarvis()
        }

        override fun onDismissCancelled() {
          finish()
        }

        override fun onDismissError() {
          Log.w(TAG, "The lock screen could not be dismissed for Jarvis.")
          finish()
        }
      },
    )
  }

  /** Opens the assistant's window, now there is nothing in front of it, and gets out of its way. */
  private fun summonJarvis() {
    if (!JarvisVoiceInteractionService.summon()) {
      Log.w(TAG, "Unlocked, but the assistant's window could not be opened.")
    }
    finish()
  }

  companion object {
    private const val TAG = "JarvisAssistant"
  }
}
