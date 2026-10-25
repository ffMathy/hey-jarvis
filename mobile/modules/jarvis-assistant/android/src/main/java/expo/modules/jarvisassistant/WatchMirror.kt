package expo.modules.jarvisassistant

import android.content.Context
import com.google.android.gms.wearable.Wearable

/**
 * The path the phone sends the watch what its sphere is doing on, while it holds a conversation the
 * watch was summoned for.
 *
 * Spelled again in the watch's `JarvisPhoneModule.kt`, and pinned to it by
 * `mobile/src/watch-link.contract.spec.ts`. No manifest claims it on the watch: frames only matter to
 * a watch app that is up and showing him, and its module listens while it is.
 */
internal const val MIRROR_PATH = "/jarvis/mirror-the-phone"

/**
 * Which watch, if any, is showing the conversation this phone is holding.
 *
 * Summoned on the wrist with AirPods in, the phone takes the conversation (`JarvisWatchSummonService`)
 * and the watch stays quiet — but the watch is still what was looked at, so it goes on showing him,
 * moving as the phone's sphere moves. The app sends a frame of that sphere every few tens of
 * milliseconds (`mirror-on-the-watch.ts`); this is where it goes, and the frames are encoded and
 * decoded by `mirrored-sphere.ts` in `hologram`.
 *
 * Followed from the moment the watch is told yes until the assistant's window is put away, when the
 * watch is sent an empty frame to say he has stopped. A message, like the rest of the protocol: a
 * frame is out of date by the time the next one leaves, so there is nothing worth storing.
 */
internal object WatchMirror {
  @Volatile private var watchNode: String? = null

  /** Starts sending frames to `nodeId`, the watch that asked. */
  fun follow(nodeId: String) {
    watchNode = nodeId
  }

  /** Whether a watch is following, so the app reads its sphere only when someone will see it. */
  fun isFollowed(): Boolean = watchNode != null

  /** One frame, to the watch following, if any. Fire and forget: the next one is a few tens of milliseconds away. */
  fun send(context: Context, frame: ByteArray) {
    val node = watchNode ?: return
    Wearable.getMessageClient(context).sendMessage(node, MIRROR_PATH, frame)
  }

  /** Stops, and tells the watch he has: an empty frame. */
  fun stop(context: Context) {
    val node = watchNode ?: return
    watchNode = null
    Wearable.getMessageClient(context).sendMessage(node, MIRROR_PATH, ByteArray(0))
  }
}
