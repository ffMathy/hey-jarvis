package expo.modules.jarvisassistant

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.service.voice.VoiceInteractionSession
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.common.LifecycleState
import com.facebook.react.interfaces.fabric.ReactSurface
import java.lang.ref.WeakReference

/**
 * What actually happens when the user summons Jarvis.
 *
 * A voice interaction session owns a window of its own, drawn by the system on top of whatever the
 * user was doing — and unlike an activity, it does not *replace* what is on screen. Nothing is
 * launched, so the launcher never runs its app-opening animation and the home screen keeps its
 * icons; another app behind simply stays drawn. That is how an assistant is supposed to appear,
 * and it is the one thing an activity cannot do however transparent its window is made: the
 * launcher animates itself to `alpha=0` the moment an app starts over it, which is why the
 * activity route could only ever show the wallpaper.
 *
 * So this session draws the app itself. React Native is rendered into the session's window through
 * a second surface on the process's existing `ReactHost` — the same JavaScript, the same running
 * instance, a second view of it — with `summoned` set in its initial props so the app knows it is
 * being asked rather than opened.
 *
 * Launching the activity is kept as the fallback, because a summoning that silently opens nothing
 * is the worst outcome available here. Anything that goes wrong on the way to a surface takes that
 * road instead, and the user sees the old behaviour rather than an empty window.
 */
class JarvisVoiceInteractionSession(context: Context) : VoiceInteractionSession(context) {

  /** The surface drawing the app into this window, once there is one. */
  private var surface: ReactSurface? = null

  /** Set only if this session was what resumed React Native, so only it un-resumes it. */
  private var resumedHost: ReactHost? = null

  /**
   * Builds the window's contents: the app, drawn into this session.
   *
   * Called by the system before {@link onShow}, which is what lets that method know whether there
   * is anything to show and fall back to the activity if there is not.
   */
  override fun onCreateContentView(): View {
    val container = FrameLayout(context)
    container.setBackgroundColor(Color.TRANSPARENT)

    val host = reactHost()
    if (host == null) {
      Log.w(TAG, "No ReactHost on the application; falling back to opening the app.")
      return container
    }

    try {
      val created = host.createSurface(context, MAIN_COMPONENT, null)
      val view = created.view
      if (view == null) {
        Log.w(TAG, "The React surface produced no view; falling back to opening the app.")
        return container
      }

      container.addView(
        view,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
      )
      created.start()
      surface = created
      resumeReactNative(host)
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not draw the app into the assistant window; falling back to opening it.", error)
      release()
    }

    return container
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)

    current = WeakReference(this)

    if (surface != null) {
      makeWindowSeeThrough()
      return
    }

    showConversationInTheApp()
    // Strictly after the start above. Hiding first would retract the session while the activity
    // start is still being authorised against it.
    hide()
  }

  override fun onHide() {
    release()
    if (current?.get() === this) {
      current = null
    }
    super.onHide()
  }

  /**
   * Lets the window show what is behind it, which is the entire point of drawing here.
   *
   * Three separate things would otherwise paint over the screen: the dialog's own background, the
   * dim the system puts behind an assistant window, and the status and navigation bar backgrounds.
   * The app paints its own scrim — see `sample-screen.tsx` — so anything painted here is a second
   * one on top of it.
   */
  private fun makeWindowSeeThrough() {
    val window = window?.window ?: return
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    // Edge to edge, which also settles the system bars: with no limits on the layout the window
    // draws under them, so there are no bar backgrounds of this window's to paint. Setting their
    // colours instead is deprecated from API 35 and does nothing there.
    window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
  }

  /**
   * Tells React Native it is on screen, if nothing else already has.
   *
   * Without this the instance stays paused, and everything that listens to the app's lifecycle
   * behaves as if nobody were looking: `AppState` reports `background`, and the hologram — which
   * stops its clock when it is not in front, deliberately — draws one frame and then nothing. The
   * check is because the app's own activity may be resumed already, in which case this session has
   * no business changing anything, and must not pause it again on the way out.
   */
  private fun resumeReactNative(host: ReactHost) {
    if (host.lifecycleState == LifecycleState.RESUMED) {
      return
    }
    host.onHostResume(null)
    resumedHost = host
  }

  /** Stops drawing, and leaves React Native as this session found it. */
  private fun release() {
    surface?.let { running ->
      try {
        running.stop()
        running.detach()
      } catch (error: RuntimeException) {
        Log.w(TAG, "Could not stop the assistant window's surface cleanly.", error)
      }
    }
    surface = null

    resumedHost?.onHostPause()
    resumedHost = null
  }

  /** The process's React Native, or null in a build that has none linked in. */
  private fun reactHost(): ReactHost? = (context.applicationContext as? ReactApplication)?.reactHost

  /**
   * The fallback: bring the app's own window to the front instead.
   *
   * `startAssistantActivity` places the activity in the assistant's own task, which is what lets
   * it come up over whatever the user summoned Jarvis from. It exists from API 26, and it throws
   * if the session has already been retracted, so a plain launch is kept behind it. That is legal
   * from a session running in the background, because the system holds this service bound with
   * BIND_ALLOW_BACKGROUND_ACTIVITY_STARTS for as long as Jarvis is the assistant.
   */
  private fun showConversationInTheApp() {
    val intent = createAssistIntent(context.packageName)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        startAssistantActivity(intent)
        return
      } catch (error: RuntimeException) {
        Log.w(TAG, "Could not start the conversation in the assistant task; falling back.", error)
      }
    }

    try {
      context.startActivity(intent)
    } catch (error: RuntimeException) {
      Log.e(TAG, "Could not open Jarvis in response to an assist gesture.", error)
    }
  }

  companion object {
    private const val TAG = "JarvisAssistant"

    /**
     * The name the app registers its summoned self under, in `mobile/index.ts`.
     *
     * Not `main`. The app has to know it is being asked rather than opened, and a separate
     * registration says so without an initial prop — which would otherwise have to survive
     * Expo's own root component typing. `assistant-window.contract.spec.ts` pins the two
     * spellings together.
     */
    private const val MAIN_COMPONENT = "assistant"

    /**
     * The session on screen, for the app to close from JavaScript.
     *
     * Weak, because the system owns the session's life and this must not be the reference that
     * keeps a retracted one alive.
     */
    private var current: WeakReference<JarvisVoiceInteractionSession>? = null

    /** Closes the assistant window, if one is open. Safe to call from any thread. */
    internal fun dismissCurrent(): Boolean {
      val session = current?.get() ?: return false
      Handler(Looper.getMainLooper()).post { session.hide() }
      return true
    }
  }
}
