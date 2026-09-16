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
   * Asks for a hardware-accelerated window, before there is anything in it.
   *
   * **This is the difference between a hologram and a slideshow here.** A window put up by a
   * service is not hardware-accelerated by default — only an activity's is — so without this flag
   * Skia rasterises every frame of the sphere on the CPU, a thousand strokes and their halos and a
   * full-canvas shadow, sixty times a second. The same drawing that a phone's GPU does not notice.
   *
   * It has to be here rather than in {@link onShow}: hardware acceleration is decided when the
   * window is attached, and a flag added afterwards is simply ignored.
   */
  override fun onCreate() {
    super.onCreate()
    window?.window?.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
  }

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
      reactHost()?.let { resumeReactNative(it) }
      return
    }

    showConversationInTheApp()
    // Strictly after the start above. Hiding first would retract the session while the activity
    // start is still being authorised against it.
    hide()
  }

  /**
   * Put away, not torn down.
   *
   * The system keeps a session alive between summonings — it hides it and shows it again — and
   * `onCreateContentView` is called once, for the window, not once per showing. Stopping the
   * surface here therefore worked exactly once: the second summoning found a session whose
   * surface was gone, decided it had nothing to draw, and fell back to launching the app. Which
   * is what the user saw, and it looked like the transparency had broken.
   *
   * So the surface stays, and only React Native's lifecycle is put back where it was found —
   * which is enough to stop the drawing, because the hologram watches `AppState` and stops its
   * clock when nothing is in front. Tearing down happens in {@link onDestroy}, where the system
   * has actually finished with the session.
   */
  override fun onHide() {
    pauseReactNative()
    if (current?.get() === this) {
      current = null
    }
    super.onHide()
  }

  override fun onDestroy() {
    release()
    super.onDestroy()
  }

  /**
   * Offers the back press to the app before taking it.
   *
   * The system's own answer is to retract the window at once, which cuts Jarvis off mid-turn. The
   * app would rather fade him out first — see `sample-screen.tsx`, which answers this through
   * React Native's `BackHandler` and calls back through `dismissAssistantWindow` when he has gone.
   * `onBackPressed` on the host returns whether anything in JavaScript took it, so the immediate
   * retraction is still there for the case where nothing did.
   */
  override fun onBackPressed() {
    if (surface != null && reactHost()?.onBackPressed() == true) {
      return
    }
    super.onBackPressed()
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

  /** Leaves React Native as this session found it, without touching the surface. */
  private fun pauseReactNative() {
    resumedHost?.onHostPause()
    resumedHost = null
  }

  /** Stops drawing for good. Only for {@link onDestroy}: see {@link onHide} for why. */
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

    pauseReactNative()
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
