package expo.modules.jarvisassistant

import android.service.voice.VoiceInteractionService

/**
 * The long-lived service the system binds to while Jarvis holds the assistant
 * role. It is what makes the app selectable in Settings under "Digital
 * assistant app", which is the whole point of this module.
 *
 * It has nothing to do: Jarvis does not run a hotword detector of its own — the
 * house already listens through the voice firmware, and a phone that listened
 * too would only add a second microphone to an already-answered question. The
 * work happens in the session, once the user has actually summoned it.
 */
class JarvisVoiceInteractionService : VoiceInteractionService()
