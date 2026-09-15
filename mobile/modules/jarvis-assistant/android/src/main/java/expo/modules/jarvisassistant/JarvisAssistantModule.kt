package expo.modules.jarvisassistant

import android.app.Activity
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Which settings screen {@link openAssistantSettings} managed to reach. */
private const val VOICE_INPUT_SETTINGS = "voice-input"
private const val DEFAULT_APPS_SETTINGS = "default-apps"
private const val ALL_SETTINGS = "settings"

private const val TAG = "JarvisAssistant"

/**
 * The JavaScript side of becoming the phone's assistant.
 *
 * Deliberately three reads and one action, with no state of its own. Whether
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
