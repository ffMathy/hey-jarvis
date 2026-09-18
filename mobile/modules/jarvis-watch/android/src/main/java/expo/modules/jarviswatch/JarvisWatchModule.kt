package expo.modules.jarviswatch

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor
import org.json.JSONObject

/**
 * The capability the watch app declares, and the only way to know it is installed.
 *
 * A phone cannot ask a watch what packages it has. It can ask the Data Layer which nearby nodes
 * advertise a named capability, and the watch app advertises this one — see
 * `withWatchCapability` in `watch/app.config.ts`, which writes the resource that declares it.
 * The two spellings have to agree, and `watch-link.contract.spec.ts` checks that they do.
 */
private const val JARVIS_ON_THE_WATCH = "jarvis_on_the_watch"

/**
 * The two message paths the phone and the watch speak over, and the whole of their protocol.
 *
 * `SETTINGS_PATH` carries the credentials one way, phone to watch, as a JSON object with an
 * `apiKey` and an `agentId` in it. `ASK_PATH` carries nothing at all in the other direction: it is
 * the watch saying it has none and would like some.
 *
 * **A message and not a data item, and that is a security decision rather than a convenience
 * one.** `DataClient` would be easier — a `DataItem` replicates on its own and arrives whenever
 * the watch next comes into range, with no need for this app to be open — but it replicates *by
 * being stored*, in Play Services' own store on both devices, which is a live API key at rest in a
 * place neither app controls. A message is handed straight to the receiving app and kept nowhere.
 *
 * All four spellings — here, in TypeScript beside it, and the same pair on the watch — have to
 * agree, with no compiler between them. `watch-link.contract.spec.ts` reads all four and fails if
 * they drift.
 */
private const val SETTINGS_PATH = "/jarvis/elevenlabs-settings"
private const val ASK_PATH = "/jarvis/ask-for-credentials"

/** What the watch is sent. Read back by `PhoneSettingsStore` on the other side. */
private fun settingsMessage(apiKey: String, agentId: String): ByteArray =
  JSONObject().put("apiKey", apiKey).put("agentId", agentId).toString().toByteArray()

/**
 * What the phone can learn about, and do to, the watch beside it.
 *
 * Deliberately two questions and one action, with no state. Whether a watch is paired and whether
 * Jarvis is on it are things the system can be asked at any moment, and a cached answer would be
 * confidently wrong the moment the user installs it — which is the one moment this exists for.
 *
 * **It cannot install anything.** That is not an omission: modern Wear OS has no supported way for
 * one device to install an app on another. The package installer has to run on the watch with
 * somebody tapping through it, and the only thing `RemoteActivityHelper` can start remotely is a
 * browsable link. So "install on the watch" means "open this app's Play page, on the watch", which
 * is exactly what Home Assistant's watch button does. The route that did work out of band — an APK
 * embedded in the phone app for Play Services to push across — died with Wear OS 1.
 */
class JarvisWatchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisWatch")

    AsyncFunction("findWatch") { promise: Promise ->
      findWatch(context(), promise)
    }

    AsyncFunction("openJarvisOnTheWatch") { promise: Promise ->
      openJarvisOnTheWatch(context(), promise)
    }

    AsyncFunction("sendSettingsToTheWatch") { apiKey: String, agentId: String, promise: Promise ->
      sendSettingsToTheWatch(context(), apiKey, agentId, promise)
    }

    Events(WATCH_ASKED)

    // Listening only while the JavaScript side is, which is the whole of the phone's half of the
    // handover: the watch can ask at any time, but only an app that is running can answer, because
    // the credentials are behind the keystore in JavaScript's hands and not in this module's.
    OnStartObserving {
      listenForAsking(context())
    }

    OnStopObserving {
      stopListeningForAsking(context())
    }
  }

  /** Forwards the watch's request up to JavaScript, which has the credentials this module does not. */
  private val asking = MessageClient.OnMessageReceivedListener { event: MessageEvent ->
    if (event.path == ASK_PATH) {
      sendEvent(WATCH_ASKED)
    }
  }

  private fun listenForAsking(context: Context) {
    Wearable.getMessageClient(context).addListener(asking)
  }

  private fun stopListeningForAsking(context: Context) {
    Wearable.getMessageClient(context).removeListener(asking)
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private companion object {
    /** The event JavaScript subscribes to in order to answer the watch. */
    const val WATCH_ASKED = "onWatchAskedForCredentials"
  }
}

/**
 * Hands the credentials to the watch, if there is a watch with Jarvis on it to hand them to.
 *
 * The **capability** rather than the connected nodes, unlike `findWatch`'s first question: a watch
 * without the app installed has nothing listening on the path, and a message sent into that is
 * accepted by Play Services and then dropped, which would look to the user exactly like a
 * successful handover.
 */
private fun sendSettingsToTheWatch(context: Context, apiKey: String, agentId: String, promise: Promise) {
  Wearable.getCapabilityClient(context)
    .getCapability(JARVIS_ON_THE_WATCH, CapabilityClient.FILTER_REACHABLE)
    .addOnSuccessListener { capability ->
      val watch = capability.nodes.firstOrNull()
      if (watch == null) {
        promise.reject("NO_WATCH", "No watch with Jarvis on it is in range.", null)
        return@addOnSuccessListener
      }
      Wearable.getMessageClient(context)
        .sendMessage(watch.id, SETTINGS_PATH, settingsMessage(apiKey, agentId))
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { error ->
          promise.reject("COULD_NOT_SEND", error.message ?: "The watch would not take the credentials.", error)
        }
    }
    .addOnFailureListener { error ->
      promise.reject("WATCH_UNREACHABLE", error.message ?: "Could not reach the Wearable service.", error)
    }
}

/** Runs the callback on whichever thread finished the work, which is all these need. */
private val rightHere = Executor { it.run() }

/**
 * Whether there is a watch, what it is called, and whether Jarvis is on it.
 *
 * Two questions of the Data Layer rather than one, because they answer different things and the
 * difference is what the setting says: connected nodes are the watches paired *and reachable now*,
 * and the capability tells which of those have the app. A watch that is paired but switched off
 * appears in neither, and "no watch" is the honest thing to say then.
 */
private fun findWatch(context: Context, promise: Promise) {
  Wearable.getNodeClient(context).connectedNodes
    .addOnSuccessListener { nodes ->
      if (nodes.isEmpty()) {
        promise.resolve(mapOf("paired" to false, "name" to null, "hasJarvis" to false))
        return@addOnSuccessListener
      }
      val watch = nodes.first()
      Wearable.getCapabilityClient(context)
        .getCapability(JARVIS_ON_THE_WATCH, CapabilityClient.FILTER_REACHABLE)
        .addOnSuccessListener { capability ->
          promise.resolve(describe(watch, capability.nodes))
        }
        .addOnFailureListener {
          // The capability lookup failing is not the same as the app being absent, but there is
          // nothing better to tell the user than what can be seen: a watch, and no Jarvis on it.
          promise.resolve(describe(watch, emptySet()))
        }
    }
    .addOnFailureListener { error ->
      promise.reject("WATCH_UNREACHABLE", error.message ?: "Could not reach the Wearable service.", error)
    }
}

private fun describe(watch: Node, withJarvis: Set<Node>) =
  mapOf(
    "paired" to true,
    "name" to watch.displayName,
    "hasJarvis" to withJarvis.any { it.id == watch.id },
  )

/**
 * Opens this app's Play Store page on the watch.
 *
 * `market://` rather than an https link, so the watch's Play Store takes it directly instead of
 * offering a browser most watches do not have. It resolves for whoever can see the listing: on an
 * internal testing track that is the accounts opted in to it, which is the watch's own account.
 */
private fun openJarvisOnTheWatch(context: Context, promise: Promise) {
  Wearable.getNodeClient(context).connectedNodes
    .addOnSuccessListener { nodes ->
      val watch = nodes.firstOrNull()
      if (watch == null) {
        promise.reject("NO_WATCH", "There is no watch connected to open anything on.", null)
        return@addOnSuccessListener
      }
      val intent =
        Intent(Intent.ACTION_VIEW)
          .addCategory(Intent.CATEGORY_BROWSABLE)
          .setData(Uri.parse("market://details?id=${context.packageName}"))
      val opening = RemoteActivityHelper(context).startRemoteActivity(intent, watch.id)
      opening.addListener(
        {
          try {
            opening.get()
            promise.resolve(true)
          } catch (error: Exception) {
            promise.reject("COULD_NOT_OPEN", error.message ?: "The watch would not open the page.", error)
          }
        },
        rightHere,
      )
    }
    .addOnFailureListener { error ->
      promise.reject("WATCH_UNREACHABLE", error.message ?: "Could not reach the Wearable service.", error)
    }
}
