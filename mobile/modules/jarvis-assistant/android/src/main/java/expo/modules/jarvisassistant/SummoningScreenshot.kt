package expo.modules.jarvisassistant

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * What was on sir's screen when he summoned Jarvis, kept for the conversation that summoning opens.
 *
 * **The system takes it, not Jarvis.** An assistant summoned by the gesture is handed a screenshot of
 * the screen it came up over, in `VoiceInteractionSession.onHandleScreenshot`, when the showing asks for
 * one (`SHOW_WITH_SCREENSHOT`) and sir has left "Use screenshot" on in the digital assistant's settings.
 * No permission is asked for, and none is held: it is the same screenshot every assistant is offered.
 * An app that marks its window secure — a bank, a password manager — arrives as no screenshot.
 *
 * **It is kept in the cache, small, and only until the next summoning.** Like a photo
 * (`JarvisPhotoActivity`), it is scaled to {@link LONG_EDGE} and written as a JPEG at
 * {@link JPEG_QUALITY}, off the main thread, into a directory of its own that every summoning empties
 * first. JavaScript reads it from there and sends it to sir's Jarvis server, which keeps it in memory
 * for a day at most (see "What was on the screen" in `.claude/rules/mobile.md`).
 *
 * **Every question about it is answered, and never left hanging.** The screenshot arrives a moment
 * after the window is shown, and the conversation asks for it when it connects, which may be before or
 * after: a question asked in between waits ({@link whenReady}), and one still waiting
 * {@link GIVE_UP_AFTER_MS} after the showing is answered with nothing — the system does not always
 * deliver one it was asked for. Each summoning is numbered, so a screenshot still being written when
 * the next summoning comes is never handed to that one's conversation.
 *
 * Main thread only, like the session that feeds it.
 */
internal object SummoningScreenshot {
  private const val TAG = "JarvisAssistant"

  /** How long after a showing a screenshot that has not arrived is given up on. */
  private const val GIVE_UP_AFTER_MS = 5_000L

  /** The longest edge it is kept at. The same as a photo's: `LONG_EDGE` in `JarvisPhotoActivity.kt`. */
  private const val LONG_EDGE = 1600

  /** JPEG quality, 0–100. The same as a photo's: `JPEG_QUALITY` in `JarvisPhotoActivity.kt`. */
  private const val JPEG_QUALITY = 85

  private val mainThread = Handler(Looper.getMainLooper())

  /** How many summonings there have been, which numbers the one under way. */
  private var summonings = 0

  /** Whether the summoning under way has a screenshot coming that has not arrived yet. */
  private var coming = false

  /** The summoning's screenshot as a `file://` URI, once it is written, or null for none. */
  private var screenshot: String? = null

  /** Whoever asked while it was still coming. */
  private val waiting = mutableListOf<(String?) -> Unit>()

  /**
   * A new summoning: forgets the last one's screen, and says whether this one's is coming.
   *
   * Not for the window coming back after the camera, which is the same summoning: its screenshot
   * still belongs to the conversation in it.
   */
  fun summoned(context: Context, withScreenshot: Boolean) {
    summonings += 1
    screenshot = null
    coming = withScreenshot
    directory(context).listFiles()?.forEach { it.delete() }
    if (!withScreenshot) {
      answer(null)
      return
    }

    val thisSummoning = summonings
    mainThread.postDelayed({
      if (summonings == thisSummoning && coming) {
        Log.i(TAG, "No screenshot arrived ${GIVE_UP_AFTER_MS / 1000} s after Jarvis was summoned.")
        coming = false
        answer(null)
      }
    }, GIVE_UP_AFTER_MS)
  }

  /** The system's screenshot for the summoning under way — null when it had none to give. */
  fun arrived(context: Context, taken: Bitmap?) {
    if (!coming) {
      return
    }
    if (taken == null) {
      coming = false
      answer(null)
      return
    }

    val thisSummoning = summonings
    val file = File(directory(context), "screen-$thisSummoning.jpg")
    Thread {
      val written =
        try {
          writeSmall(taken, file)
        } catch (error: IOException) {
          Log.w(TAG, "Could not keep the screenshot taken when Jarvis was summoned.", error)
          file.delete()
          null
        } catch (error: RuntimeException) {
          Log.w(TAG, "Could not keep the screenshot taken when Jarvis was summoned.", error)
          file.delete()
          null
        }
      mainThread.post {
        if (summonings != thisSummoning || !coming) {
          written?.delete()
          return@post
        }
        coming = false
        screenshot = written?.let { Uri.fromFile(it).toString() }
        answer(screenshot)
      }
    }.start()
  }

  /** Gives `receive` the summoning's screenshot as a `file://` URI, or null — at once, unless it is still coming. */
  fun whenReady(receive: (String?) -> Unit) {
    if (coming) {
      waiting += receive
      return
    }
    receive(screenshot)
  }

  private fun answer(uri: String?) {
    val everyone = waiting.toList()
    waiting.clear()
    everyone.forEach { it(uri) }
  }

  /** Where screenshots pass through: in the cache, and apart from the photos `JarvisPhotoActivity` clears. */
  private fun directory(context: Context): File = File(context.cacheDir, "jarvis-screenshots").apply { mkdirs() }

  /**
   * Scales and writes it as a JPEG. A copy is drawn from first when the system handed over a hardware
   * bitmap, whose pixels cannot be read on the CPU.
   */
  private fun writeSmall(taken: Bitmap, file: File): File {
    val readable =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && taken.config == Bitmap.Config.HARDWARE) {
        taken.copy(Bitmap.Config.ARGB_8888, false) ?: throw IOException("The screenshot could not be read.")
      } else {
        taken
      }

    val scale = LONG_EDGE.toFloat() / max(readable.width, readable.height)
    val sized =
      if (scale < 1f) {
        Bitmap.createScaledBitmap(
          readable,
          (readable.width * scale).roundToInt(),
          (readable.height * scale).roundToInt(),
          true,
        )
      } else {
        readable
      }

    try {
      FileOutputStream(file).use { output ->
        if (!sized.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) {
          throw IOException("The screenshot could not be written as a JPEG.")
        }
      }
    } finally {
      if (sized !== readable) {
        sized.recycle()
      }
      if (readable !== taken) {
        readable.recycle()
      }
    }
    return file
  }
}
