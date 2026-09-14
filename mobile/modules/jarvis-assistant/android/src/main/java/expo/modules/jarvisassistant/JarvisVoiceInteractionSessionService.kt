package expo.modules.jarvisassistant

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/**
 * Creates one {@link JarvisVoiceInteractionSession} per summoning.
 *
 * Named by `android:sessionService` in
 * `res/xml/jarvis_voice_interaction_service.xml` — the system refuses the whole
 * voice interaction service if that attribute does not resolve to a service
 * declared in this manifest.
 */
class JarvisVoiceInteractionSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = JarvisVoiceInteractionSession(this)
}
