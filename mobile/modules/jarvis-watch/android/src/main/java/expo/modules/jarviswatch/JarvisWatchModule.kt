package expo.modules.jarviswatch

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor

/**
 * The capability the watch app declares, and the only way to know it is installed.
 *
 * A phone cannot ask a watch what packages it has. It can ask the Data Layer which nearby nodes
 * advertise a named capability, and the watch app advertises this one — see
 * `withWatchCapability` in `wear/app.config.ts`, which writes the resource that declares it.
 * The two spellings have to agree, and `watch-link.contract.spec.ts` checks that they do.
 */
private const val JARVIS_ON_THE_WATCH = "jarvis_on_the_watch"

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
  }

  private fun context(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
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
