package expo.modules.jarvisphone

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject

/**
 * Where the ElevenLabs credentials live on the watch once the phone has handed them over.
 *
 * **Not `expo-secure-store`, and the reason is the service beside this file.** The phone's copy is
 * in `expo-secure-store`, which is the right answer there because only JavaScript ever reads it.
 * Here the credentials arrive in a `WearableListenerService` that Play Services starts when a
 * message lands — often with no React Native runtime alive at all — so the store has to be
 * readable and writable from Kotlin. `EncryptedSharedPreferences` is that, with the same
 * protection: AES-GCM under a key that lives in the watch's own Android Keystore and never leaves
 * it, so the file on disk is useless to anything that reads it without this app's user ID.
 *
 * What the keystore does and does not protect the key from is the same list as on the phone — see
 * "Credentials" in `watch/AGENTS.md`.
 */
internal object PhoneSettingsStore {
  /** Its own file, so nothing else this app keeps shares the encryption of a live credential. */
  private const val FILE = "jarvis.phone-settings"

  private const val API_KEY = "apiKey"
  private const val AGENT_ID = "agentId"

  /**
   * Where the Jarvis server is, when the phone has one: optional, and not a secret. Its shape is
   * checked in JavaScript (`readPhoneServerAddress`), by the same rules the phone checked it with.
   */
  private const val SERVER_ADDRESS = "serverAddress"

  /**
   * The JWT the Cloudflare Zero Trust application in front of the server accepts, when the phone has
   * one: a credential, kept encrypted beside the ElevenLabs key. Checked in JavaScript
   * (`readPhoneServerToken`).
   */
  private const val SERVER_TOKEN = "serverToken"

  /**
   * The store, or null when it cannot be opened at all.
   *
   * It genuinely can fail, and not only in theory: `EncryptedSharedPreferences.create` reads the
   * keystore, and a keystore key can be invalidated by an OS update or a restore — the same
   * failure the phone handles in `settings-storage.ts`. Every caller below treats that as "there
   * are no credentials", which puts the watch back on the waiting screen and lets the phone hand
   * them over again. The alternative is a `GeneralSecurityException` out of a `Function` call and a
   * watch app that will not start.
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
   * Stores what arrived, or says the payload was not credentials.
   *
   * The message is parsed rather than trusted. Nothing but this app's own twin — same package
   * name, same signing key, which is Play Services' precondition for the two ever connecting —
   * can send on this path, so a malformed payload is far more likely to be a version skew than an
   * attack; either way an empty or absent field is refused rather than stored, because a stored
   * empty key reads back as "set up" and then fails at ElevenLabs with nothing to point at.
   */
  fun save(context: Context, payload: ByteArray): Boolean {
    val settings =
      try {
        JSONObject(String(payload, Charsets.UTF_8))
      } catch (_: Exception) {
        return false
      }

    val apiKey = settings.optString(API_KEY).trim()
    val agentId = settings.optString(AGENT_ID).trim()
    if (apiKey.isEmpty() || agentId.isEmpty()) {
      return false
    }

    val serverAddress = settings.optString(SERVER_ADDRESS).trim()
    val serverToken = settings.optString(SERVER_TOKEN).trim()
    val preferences = preferences(context) ?: return false
    val editor = preferences.edit().putString(API_KEY, apiKey).putString(AGENT_ID, agentId)
    // A phone that has forgotten its address or token hands over none, and the watch forgets it too.
    if (serverAddress.isEmpty()) editor.remove(SERVER_ADDRESS) else editor.putString(SERVER_ADDRESS, serverAddress)
    if (serverToken.isEmpty()) editor.remove(SERVER_TOKEN) else editor.putString(SERVER_TOKEN, serverToken)
    editor.commit()
    return true
  }

  /** What is stored, or null when the watch has never been given anything. */
  fun read(context: Context): Map<String, String>? {
    val preferences = preferences(context) ?: return null
    val apiKey = preferences.getString(API_KEY, null) ?: return null
    val agentId = preferences.getString(AGENT_ID, null) ?: return null
    if (apiKey.isEmpty() || agentId.isEmpty()) {
      return null
    }
    val stored = mutableMapOf(API_KEY to apiKey, AGENT_ID to agentId)
    preferences.getString(SERVER_ADDRESS, null)?.takeIf { it.isNotEmpty() }?.let { stored[SERVER_ADDRESS] = it }
    preferences.getString(SERVER_TOKEN, null)?.takeIf { it.isNotEmpty() }?.let { stored[SERVER_TOKEN] = it }
    return stored
  }

  /** Forgets them, for a watch being handed on or a key being rotated. */
  fun forget(context: Context) {
    preferences(context)?.edit()?.clear()?.commit()
  }
}
