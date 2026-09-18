package expo.modules.jarvisphone

import android.content.Context
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The two message paths the watch and the phone speak over, and the whole of their protocol.
 *
 * The same two strings as `SETTINGS_PATH` and `ASK_PATH` in the phone's
 * `mobile/modules/jarvis-watch/.../JarvisWatchModule.kt`, spelled again because Kotlin on two
 * devices shares no header file. Four copies in all, counting the TypeScript beside each, with no
 * compiler between any of them — so `mobile/src/watch-link.contract.spec.ts` reads all four out of
 * their sources and fails if they drift.
 *
 * Nothing fails loudly when they do. Both apps build, both install, both run, and the watch waits
 * for a message the phone is sending to an address nobody is listening at.
 */
internal const val SETTINGS_PATH = "/jarvis/elevenlabs-settings"
internal const val ASK_PATH = "/jarvis/ask-for-credentials"

/**
 * What the watch knows about the phone beside it: only ever the ElevenLabs credentials.
 *
 * A watch keyboard is not where anybody should type a key that starts `sk_` and runs to fifty
 * characters, so the watch never asks for one. It asks the *phone*, over the Data Layer, which
 * Play Services will only connect for two apps sharing a package name and a signing key — and
 * `watch/app.config.ts` shares both with `mobile/` for exactly this reason.
 *
 * The receiving half is split in two on purpose. This module hears the phone while the app is
 * running, so a screen can stop waiting the moment the key lands; `JarvisPhoneListenerService`
 * hears it when the app is not, so the phone's button works without anybody opening the watch
 * first. Both write to `PhoneSettingsStore`, which is the only place the credentials are kept.
 */
class JarvisPhoneModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisPhone")

    // What is stored, if anything. Synchronous: the first screen has to decide what to draw.
    Function("readSettings") {
      PhoneSettingsStore.read(context())
    }

    Function("forgetSettings") {
      PhoneSettingsStore.forget(context())
    }

    // Asks the phone to send them. Resolves false rather than rejecting when there is no phone in
    // range: a watch out of Bluetooth range of its phone is the ordinary state of a watch on a
    // run, not an error, and the screen says "open Jarvis on your phone" either way.
    AsyncFunction("askThePhone") { promise: Promise ->
      askThePhone(context(), promise)
    }

    Events(SETTINGS_ARRIVED)

    OnStartObserving {
      Wearable.getMessageClient(context()).addListener(arriving)
    }

    OnStopObserving {
      Wearable.getMessageClient(context()).removeListener(arriving)
    }
  }

  /**
   * The phone answering, while this app is up.
   *
   * Stores first and tells JavaScript second, so that a screen woken by the event reads the
   * credentials straight out of the store rather than being handed them in an event payload —
   * which would put a live API key through the JavaScript bridge for no reason, and leave two
   * answers to "what are the credentials" that could disagree.
   */
  private val arriving = MessageClient.OnMessageReceivedListener { event: MessageEvent ->
    if (event.path == SETTINGS_PATH && PhoneSettingsStore.save(context(), event.data)) {
      sendEvent(SETTINGS_ARRIVED)
    }
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private companion object {
    /** The event a waiting screen subscribes to, so it can stop waiting. */
    const val SETTINGS_ARRIVED = "onSettingsArrived"
  }
}

/**
 * Sends the phone a request with nothing in it, which is the whole of the asking.
 *
 * To every connected node rather than a named one. A watch has exactly one phone, but the node it
 * appears as is not something this app should be picking out by name, and a request carrying no
 * payload costs nothing to send twice.
 */
private fun askThePhone(context: Context, promise: Promise) {
  Wearable.getNodeClient(context).connectedNodes
    .addOnSuccessListener { nodes ->
      if (nodes.isEmpty()) {
        promise.resolve(false)
        return@addOnSuccessListener
      }
      val client = Wearable.getMessageClient(context)
      for (node in nodes) {
        client.sendMessage(node.id, ASK_PATH, ByteArray(0))
      }
      // Asked, which is not the same as answered: the phone answers by sending the credentials
      // back on the other path, and that arrives as an event rather than as this promise.
      promise.resolve(true)
    }
    .addOnFailureListener { promise.resolve(false) }
}
