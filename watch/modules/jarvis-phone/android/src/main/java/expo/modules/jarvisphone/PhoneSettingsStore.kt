package expo.modules.jarvisphone

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject

/**
 * Where the phone's pairing with the Jarvis server lives on the watch once the phone has handed it
 * over: the server's address, and the device token the server gave the phone. The watch shares the
 * phone's pairing rather than having one of its own, so unpairing the phone unpairs the watch too.
 *
 * **Not `expo-secure-store`, and the reason is the service beside this file.** The phone's copy is
 * in `expo-secure-store`, which is the right answer there because only JavaScript ever reads it.
 * Here the pairing arrives in a `WearableListenerService` that Play Services starts when a message
 * lands — often with no React Native runtime alive at all — so the store has to be readable and
 * writable from Kotlin. `EncryptedSharedPreferences` is that, with the same protection: AES-GCM
 * under a key that lives in the watch's own Android Keystore and never leaves it, so the file on
 * disk is useless to anything that reads it without this app's user ID.
 *
 * What the keystore does and does not protect the token from is the same list as on the phone — see
 * `.claude/rules/watch-credentials-the-phone-hands-them-over.md`.
 */
internal object PhoneSettingsStore {
  /** Its own file, so nothing else this app keeps shares the encryption of a live credential. */
  private const val FILE = "jarvis.phone-settings"

  /**
   * Where the Jarvis server is: not a secret. Its shape is checked in JavaScript
   * (`readPhonePairing`), by the same rules the phone checked it with.
   */
  private const val SERVER_ADDRESS = "serverAddress"

  /** The token the server paired the phone with: a credential. Checked in JavaScript too. */
  private const val DEVICE_TOKEN = "deviceToken"

  /**
   * What an earlier version of the app kept here — an ElevenLabs API key, the agent's ID and a
   * Cloudflare Access service token — none of which any app holds any more. Removed on every save,
   * so a watch updated from one does not go on keeping a live key it will never read.
   */
  private val NO_LONGER_KEPT = listOf("apiKey", "agentId", "serverClientId", "serverClientSecret")

  /**
   * The store, or null when it cannot be opened at all.
   *
   * It genuinely can fail, and not only in theory: `EncryptedSharedPreferences.create` reads the
   * keystore, and a keystore key can be invalidated by an OS update or a restore — the same
   * failure the phone handles in `jarvis-server.ts`. Every caller below treats that as "there is no
   * pairing", which puts the watch back on the waiting screen and lets the phone hand it over
   * again. The alternative is a `GeneralSecurityException` out of a `Function` call and a watch app
   * that will not start.
   */
  private fun preferences(context: Context): SharedPreferences? =
    try {
      openPreferences(context)
    } catch (_: Exception) {
      null
    }

  private fun openPreferences(context: Context): SharedPreferences =
    EncryptedSharedPreferences.create(
      FILE,
      MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
      context,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

  /**
   * Stores what arrived, or says the payload was not a pairing.
   *
   * The message is parsed rather than trusted. Nothing but this app's own twin — same package
   * name, same signing key, which is Play Services' precondition for the two ever connecting —
   * can send on this path, so a malformed payload is far more likely to be a version skew than an
   * attack; either way an empty or absent field is refused rather than stored, because a stored
   * empty token reads back as "set up" and then fails at the server with nothing to point at.
   */
  fun save(context: Context, payload: ByteArray): Boolean {
    val pairing =
      try {
        JSONObject(String(payload, Charsets.UTF_8))
      } catch (_: Exception) {
        return false
      }

    val serverAddress = pairing.optString(SERVER_ADDRESS).trim()
    val deviceToken = pairing.optString(DEVICE_TOKEN).trim()
    if (serverAddress.isEmpty() || deviceToken.isEmpty()) {
      return false
    }

    val preferences = preferences(context) ?: return false
    val editor = preferences.edit().putString(SERVER_ADDRESS, serverAddress).putString(DEVICE_TOKEN, deviceToken)
    for (key in NO_LONGER_KEPT) {
      editor.remove(key)
    }
    editor.commit()
    return true
  }

  /** What is stored, or null when the watch has never been given a pairing. */
  fun read(context: Context): Map<String, String>? {
    val preferences = preferences(context) ?: return null
    val serverAddress = preferences.getString(SERVER_ADDRESS, null) ?: return null
    val deviceToken = preferences.getString(DEVICE_TOKEN, null) ?: return null
    if (serverAddress.isEmpty() || deviceToken.isEmpty()) {
      return null
    }
    return mapOf(SERVER_ADDRESS to serverAddress, DEVICE_TOKEN to deviceToken)
  }

  /** Forgets it, for a watch being handed on. */
  fun forget(context: Context) {
    preferences(context)?.edit()?.clear()?.commit()
  }
}
