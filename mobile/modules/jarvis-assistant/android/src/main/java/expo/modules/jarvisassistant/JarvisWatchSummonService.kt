package expo.modules.jarvisassistant

import android.app.KeyguardManager
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.TaskCompletionSource
import com.google.android.gms.wearable.WearableListenerService

/**
 * The path the watch asks on, and the phone answers on, when it is summoned.
 *
 * Spelled again in the watch's `JarvisPhoneModule.kt`, with no compiler between the two, so
 * `mobile/src/watch-link.contract.spec.ts` reads both out of their sources and fails if they drift.
 * So does the `<data>` path in this module's manifest, which is what wakes this service for it.
 */
internal const val ANSWER_PATH = "/jarvis/answer-on-the-phone"

/** The whole of the reply: one byte, 1 if the phone has taken the conversation. */
private val ANSWERING = byteArrayOf(1)
private val NOT_ANSWERING = byteArrayOf(0)

/**
 * How long the assistant's window has to come up before the watch is told to talk for itself.
 *
 * It has to stay under `ASK_THE_PHONE_MS` in `watch/src/conversation-screen.tsx`, which is how long
 * the watch waits for this reply: a phone that opened after the watch gave up would be a second
 * Jarvis talking over the first.
 *
 * Past it, nothing can take the request back. `VoiceInteractionService` has a public `showSession`
 * and no public way to cancel one, so a window the system opens later than this still opens, and
 * both of them talk. Two seconds is generous for a window that normally appears within a few
 * hundred milliseconds or not at all.
 */
private const val WAIT_FOR_THE_WINDOW_MS = 2000L

/**
 * Answers the watch in the phone's earbuds, instead of out of the watch's speaker.
 *
 * Summoned on the wrist, Jarvis talks through the watch's loudspeaker — to everyone within a few
 * metres. When the phone in the same pocket has AirPods (or any Bluetooth headset) connected, that
 * is the wrong place: the conversation belongs in the ears of whoever summoned it. A watch cannot
 * play into a headset connected to its phone — Android has no such route — so the phone holds the
 * conversation instead, exactly as if its own assistant gesture had been made, and its call audio
 * goes to the headset as it always does (`usePreferredHeadset`, and `startCallAudio` in `hologram`).
 *
 * The watch asks on every summoning with `MessageClient.sendRequest`, and this replies. It says yes
 * only once the assistant's window has actually been shown; everything short of that is a no, and
 * the watch goes on and talks for itself:
 *
 * - **No Bluetooth headset connected.** Then the phone's speaker is no more private than the
 *   watch's, and the watch is the one being looked at.
 * - **The phone is locked.** Jarvis runs the house, which is why he is not offered on the lock
 *   screen (`supportsLaunchVoiceAssistFromKeyguard` is false), and a summoning from the watch does
 *   not get around that. A phone kept unlocked by its watch, through Smart Lock, is not locked.
 * - **Jarvis is not the phone's assistant.** Only the active voice interaction service may open a
 *   session, so there is nothing to open.
 *
 * `WearableListenerService` checks that it is Play Services calling, and the Data Layer only
 * connects this app to its twin on the watch — same package name, same signing key — so the
 * request has no payload to validate.
 */
class JarvisWatchSummonService : WearableListenerService() {
  private val main = Handler(Looper.getMainLooper())

  override fun onRequest(nodeId: String, path: String, request: ByteArray): Task<ByteArray>? {
    if (path != ANSWER_PATH) {
      return null
    }
    val reply = TaskCompletionSource<ByteArray>()
    main.post { answer(reply) }
    return reply.task
  }

  /** On the main thread, where the session's `onShow` also runs. */
  private fun answer(reply: TaskCompletionSource<ByteArray>) {
    if (!hasBluetoothHeadset() || isLocked()) {
      reply.setResult(NOT_ANSWERING)
      return
    }

    JarvisVoiceInteractionSession.nextShowing = { reply.trySetResult(ANSWERING) }
    if (!JarvisVoiceInteractionService.summon()) {
      JarvisVoiceInteractionSession.nextShowing = null
      reply.setResult(NOT_ANSWERING)
      return
    }

    main.postDelayed(
      {
        if (reply.trySetResult(NOT_ANSWERING)) {
          JarvisVoiceInteractionSession.nextShowing = null
        }
      },
      WAIT_FOR_THE_WINDOW_MS,
    )
  }

  /** Whether a headset that can carry a call — Bluetooth Classic or LE Audio — is connected. */
  private fun hasBluetoothHeadset(): Boolean {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return audioManager.availableCommunicationDevices.any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
      }
    }
    return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
    }
  }

  /** Locked behind a PIN, pattern or password — not merely showing a lock screen that swipes away. */
  private fun isLocked(): Boolean {
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return true
    return keyguard.isDeviceLocked
  }
}
