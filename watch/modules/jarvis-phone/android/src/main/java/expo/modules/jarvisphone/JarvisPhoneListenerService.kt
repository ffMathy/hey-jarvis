package expo.modules.jarvisphone

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Hears the phone even when the watch app is not running.
 *
 * This is what makes "send the key to your watch" a button somebody can press on the phone without
 * first going and opening Jarvis on their wrist. Play Services starts this service when a message
 * arrives on a path the manifest claims, whether or not the app has a process, let alone a React
 * Native runtime — so the credentials are stored by Kotlin, into `PhoneSettingsStore`, and the app
 * finds them there the next time it opens.
 *
 * The running app has its own listener in `JarvisPhoneModule` and both fire when it is up. That is
 * deliberate rather than tolerated: the module's listener is what tells the screen to stop waiting
 * and start talking, and both write the same two values to the same store, so the duplicate write
 * is a no-op and neither has to know whether the other happened.
 */
class JarvisPhoneListenerService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path == SETTINGS_PATH) {
      PhoneSettingsStore.save(applicationContext, event.data)
    }
  }
}
