package expo.modules.jarvisnetwork

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Wi-Fi or cellular for the length of a conversation, instead of the phone's Bluetooth.
 *
 * **A watch near its phone is online through the phone**, over a Bluetooth proxy that Wear OS
 * makes the default network whenever it can, because it is the cheapest one to keep up. It is
 * built for notifications and small syncs: it carries TCP only, at a fraction of Wi-Fi's
 * bandwidth. A conversation is WebRTC, which wants UDP for its media — so on that network the
 * token request succeeds, the session can even report itself connected, and no audio arrives in
 * either direction. Jarvis on the wrist said nothing, while the same agent on the phone answered.
 *
 * Google's answer for anything that streams is to ask for a fast network explicitly and bind the
 * process to it, which is what this does: `requestNetwork` brings Wi-Fi (or LTE, on a watch that
 * has it) up if it is not already, and `bindProcessToNetwork` sends every socket this process opens
 * over it — native ones included, which is what matters, since WebRTC's are native.
 *
 * It is released as soon as the conversation is, because a radio held up for nobody is the thing
 * that empties a watch's battery.
 */
class JarvisNetworkModule : Module() {
  private var holding: ConnectivityManager.NetworkCallback? = null

  override fun definition() = ModuleDefinition {
    Name("JarvisNetwork")

    // Resolves with what it got — "wifi", "cellular" or "other" — or "none" if nothing came up
    // within the time given. Never rejects: no fast network is a worse conversation, not a reason
    // to refuse to try one over whatever there is.
    AsyncFunction("holdFastNetwork") { timeoutMs: Int, promise: Promise ->
      holdFastNetwork(context(), timeoutMs, promise)
    }

    Function("releaseFastNetwork") {
      release(context())
    }

    OnDestroy {
      appContext.reactContext?.let { release(it) }
    }
  }

  private fun holdFastNetwork(context: Context, timeoutMs: Int, promise: Promise) {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    if (connectivity == null) {
      promise.resolve(NONE)
      return
    }

    // Asked again for every conversation rather than kept: the one held for the last may be gone.
    release(context)

    // Both transports in one request, which matches either — Wi-Fi first in practice, since the
    // system prefers it when both could satisfy the request.
    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
      .build()

    var answered = false
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        connectivity.bindProcessToNetwork(network)
        if (!answered) {
          answered = true
          promise.resolve(describe(connectivity.getNetworkCapabilities(network)))
        }
      }

      override fun onLost(network: Network) {
        // Back to the system's choice rather than pinned to a network that no longer exists, which
        // would leave the process with no route at all.
        if (connectivity.boundNetworkForProcess == network) {
          connectivity.bindProcessToNetwork(null)
        }
      }

      override fun onUnavailable() {
        holding = null
        if (!answered) {
          answered = true
          promise.resolve(NONE)
        }
      }
    }

    holding = callback
    try {
      connectivity.requestNetwork(request, callback, timeoutMs.coerceAtLeast(1))
    } catch (error: RuntimeException) {
      // A SecurityException without CHANGE_NETWORK_STATE, or too many requests outstanding. Either
      // way the conversation goes ahead on whatever network there already is.
      holding = null
      if (!answered) {
        answered = true
        promise.resolve(NONE)
      }
    }
  }

  private fun release(context: Context) {
    val callback = holding ?: return
    holding = null
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
    connectivity.bindProcessToNetwork(null)
    try {
      connectivity.unregisterNetworkCallback(callback)
    } catch (error: IllegalArgumentException) {
      // Already unregistered by the system after `onUnavailable`: nothing left to release.
    }
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private companion object {
    const val NONE = "none"

    fun describe(capabilities: NetworkCapabilities?): String = when {
      capabilities == null -> "other"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      else -> "other"
    }
  }
}
