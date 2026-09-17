package expo.modules.jarvisassistant

import android.content.Intent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * A recognition service that recognises nothing, on purpose.
 *
 * Android will not accept a voice interaction service whose
 * `android:recognitionService` does not resolve, and it reports that by quietly
 * leaving the app out of the assistant picker rather than by failing the build.
 * So one has to exist.
 *
 * It does not have to work, and here it should not: Jarvis transcribes speech
 * inside the conversation — ElevenLabs runs the ASR on the audio stream — so
 * there is no separate recogniser to hand out. Answering every request with an
 * error is the honest version of that. The alternative, pretending to recognise
 * and returning nothing, would hang any app that asked.
 */
class JarvisRecognitionService : RecognitionService() {

  override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
    listener?.error(SpeechRecognizer.ERROR_CLIENT)
  }

  override fun onCancel(listener: Callback?) = Unit

  override fun onStopListening(listener: Callback?) = Unit
}
