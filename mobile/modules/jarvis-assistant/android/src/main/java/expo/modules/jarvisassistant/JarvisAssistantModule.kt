package expo.modules.jarvisassistant

import android.app.Activity
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Which settings screen {@link openAssistantSettings} managed to reach. */
private const val VOICE_INPUT_SETTINGS = "voice-input"
private const val DEFAULT_APPS_SETTINGS = "default-apps"
private const val ALL_SETTINGS = "settings"

private const val TAG = "JarvisAssistant"

/**
 * The event telling JavaScript the assistant's window was put away, so the conversation in it hangs
 * up. Spelled the same as `WINDOW_PUT_AWAY` in `mobile/modules/jarvis-assistant/index.ts`, which
 * `assistant-window.contract.spec.ts` holds it to.
 */
private const val WINDOW_PUT_AWAY = "onAssistantWindowPutAway"

/**
 * The JavaScript side of becoming the phone's assistant.
 *
 * Deliberately a few reads and actions, with no state of its own. Whether
 * Jarvis is the assistant is something the system can be asked at any moment,
 * and asking beats caching here: the user can change the assistant from Settings
 * while the app is in the background, and a cached answer would then be
 * confidently wrong on the one screen whose entire job is to say whether Jarvis
 * is set up.
 *
 * Notably absent is anything built on `RoleManager.createRequestRoleIntent`.
 * Android declares the assistant role as not requestable, so that intent
 * resolves, starts, and finishes immediately with no dialog — a first-run flow
 * built on it reads as correct and shows the user a flicker. Settings is the
 * only route, so Settings is the only route offered.
 *
 * It also takes a photo for Jarvis, because the camera has to be reached from the assistant's
 * window as well as the app, and only this module knows that window. See `JarvisPhotoActivity`.
 */
class JarvisAssistantModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisAssistant")

    Function("isAssistantRoleHeld") {
      isAssistantRoleHeld(context())
    }

    Function("isVoiceInteractionServiceActive") {
      isVoiceInteractionServiceActive(context())
    }

    Function("canReachAssistantSettings") {
      canReachAssistantSettings(context())
    }

    Function("openAssistantSettings") {
      openAssistantSettings(activity())
    }

    Function("dismissAssistantWindow") {
      JarvisVoiceInteractionSession.dismissCurrent()
    }

    AsyncFunction("takePhoto") { inAssistantWindow: Boolean, promise: Promise ->
      takePhoto(context(), appContext.currentActivity, inAssistantWindow) { photo -> promise.resolve(photo) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("returnFromTheCamera") { showWindowAgain: Boolean ->
      JarvisVoiceInteractionSession.returnFromTheCamera(showWindowAgain)
    }.runOnQueue(Queues.MAIN)

    Events(WINDOW_PUT_AWAY)

    // Main thread, because the session reads it there: `onHide` runs on the main looper.
    OnStartObserving {
      Handler(Looper.getMainLooper()).post {
        JarvisVoiceInteractionSession.whenPutAway = { sendEvent(WINDOW_PUT_AWAY) }
      }
    }

    OnStopObserving {
      Handler(Looper.getMainLooper()).post {
        JarvisVoiceInteractionSession.whenPutAway = null
      }
    }
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun activity(): Activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
}

/** Whether Jarvis is the assistant this phone summons right now. */
private fun isAssistantRoleHeld(context: Context): Boolean {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    val roleManager = context.getSystemService(RoleManager::class.java)
    if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) {
      return roleManager.isRoleHeld(RoleManager.ROLE_ASSISTANT)
    }
  }

  return isVoiceInteractionServiceActive(context)
}

/**
 * Whether the system is driving Jarvis through the full voice interaction
 * session rather than the cut-down assist intent.
 *
 * Worth reporting separately, because holding the role without this is a real
 * and otherwise invisible state: it is what an Android Go device does, and what
 * a manifest missing `supportsAssist` produces. Jarvis still opens either way —
 * that is what `JarvisAssistActivity` is for — but only the session path can put
 * the conversation over the app the user was already in.
 */
private fun isVoiceInteractionServiceActive(context: Context): Boolean =
  VoiceInteractionService.isActiveService(
    context,
    ComponentName(context, JarvisVoiceInteractionService::class.java),
  )

/**
 * Whether there is an assistant picker on this device to send the user to.
 *
 * Some manufacturers ship without one, and a setup screen that keeps asking the
 * user to go somewhere that does not exist is worse than one that says so.
 */
private fun canReachAssistantSettings(context: Context): Boolean =
  assistantSettingsIntents().any { it.resolveActivity(context.packageManager) != null }

/**
 * Where the assistant is chosen, best screen first.
 *
 * The role picker itself cannot be deep-linked — the activity behind it is
 * guarded by a privileged permission — so the closest an app can get is the
 * "Assist & voice input" screen, and the rest is two taps the user makes.
 */
private fun assistantSettingsIntents(): List<Intent> =
  listOf(
    Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
    Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
    Intent(Settings.ACTION_SETTINGS),
  )

/** Opens the best assistant picker this device has, and says which one that was. */
private fun openAssistantSettings(activity: Activity): String {
  val screens = listOf(VOICE_INPUT_SETTINGS, DEFAULT_APPS_SETTINGS, ALL_SETTINGS)

  for ((intent, screen) in assistantSettingsIntents().zip(screens)) {
    if (intent.resolveActivity(activity.packageManager) == null) {
      continue
    }

    try {
      activity.startActivity(intent)
      return screen
    } catch (error: RuntimeException) {
      Log.i(TAG, "Could not open the $screen settings screen; trying the next one.", error)
    }
  }

  throw IllegalStateException("This device has no settings screen for choosing an assistant.")
}

/**
 * Opens the phone's camera app for one photo, and gives `receive` the photo's `file://` URI — or
 * null, for a photo not taken, or `NOT_READABLE`, for one taken that could not be made ready to send.
 * See `JarvisPhotoActivity`.
 *
 * **From the app's own activity it is an ordinary start**, on top of the conversation, which comes
 * back into view when the camera is done.
 *
 * **From the assistant's window the window has to make way.** It is drawn above every app, the
 * camera included, so the photo activity is started in a task of its own and the window put away
 * after it — in that order, as `showConversationInTheApp` does, because the start is authorised
 * against the window being there. React Native is kept running while it is away, so the
 * conversation goes on being kept alive and the photo can be sent the moment it is taken; whether
 * the window then comes back is JavaScript's to decide, since only it knows whether there is still
 * a conversation to come back to. See `returnFromTheCamera`.
 *
 * Nowhere to start it from — no window to put away, no activity in front — is a photo not taken.
 */
private fun takePhoto(context: Context, activity: Activity?, inAssistantWindow: Boolean, receive: (String?) -> Unit) {
  val request = JarvisPhotoActivity.awaitPhoto(receive)
  val intent = Intent(context, JarvisPhotoActivity::class.java).putExtra(JarvisPhotoActivity.REQUEST, request)

  try {
    if (!inAssistantWindow) {
      if (activity == null) {
        JarvisPhotoActivity.deliver(request, null)
        return
      }
      activity.startActivity(intent)
      return
    }

    if (!JarvisVoiceInteractionSession.isShowing()) {
      JarvisPhotoActivity.deliver(request, null)
      return
    }
    // A task of its own, replacing any photo task an earlier request left behind.
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    context.startActivity(intent)
    JarvisVoiceInteractionSession.makeWayForTheCamera()
  } catch (error: RuntimeException) {
    Log.w(TAG, "Could not open the camera for a photo.", error)
    JarvisPhotoActivity.deliver(request, null)
  }
}
