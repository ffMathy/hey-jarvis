package expo.modules.jarvisassistant

import android.app.Activity
import android.os.Bundle
import android.util.Log

/**
 * Answers the plain `ASSIST` intent, for the devices and launchers that fire one
 * instead of going through the voice interaction session.
 *
 * It draws nothing and lives for one call: forward to the app, finish. Finishing
 * before `onResume` is what `Theme.NoDisplay` requires — an activity with that
 * theme that stays alive long enough to be resumed is killed by the system.
 */
class JarvisAssistActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    try {
      startActivity(createAssistIntent(packageName))
    } catch (error: RuntimeException) {
      Log.e("JarvisAssistant", "Could not open Jarvis in response to an assist intent.", error)
    }

    finish()
  }
}
