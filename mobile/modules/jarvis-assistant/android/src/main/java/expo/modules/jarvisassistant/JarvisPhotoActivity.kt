package expo.modules.jarvisassistant

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.lang.ref.WeakReference
import kotlin.math.max
import kotlin.math.min

/**
 * Takes one photo for Jarvis with the phone's own camera app, and hands back a small, upright JPEG.
 *
 * **Not a camera of our own, because there is nowhere to put one.** Summoned, the conversation is
 * drawn in the assistant's window, which is a voice interaction session and not an activity — and
 * every in-app camera there is (expo-camera's view binds CameraX to the current activity, the image
 * picker launches for a result from it) asks for an activity that window does not have. So this is
 * the activity, for exactly as long as one photo takes: it hands `ACTION_IMAGE_CAPTURE` to whatever
 * camera app the phone has, and finishes when that answers.
 *
 * **Which is also why Jarvis still holds no camera permission.** `app.config.ts` blocks `CAMERA`,
 * and `ACTION_IMAGE_CAPTURE` asks for none from an app that does not declare it: the camera app is
 * the one that opens the camera, for one shot, while sir is looking at it. Declaring `CAMERA` would
 * change that — the intent then throws unless the permission has been granted, and the assistant's
 * window cannot show a permission dialog.
 *
 * **What comes back is ready to send.** A phone's photo is several megabytes, turned by an EXIF tag
 * rather than in its pixels. It is decoded at a fraction of its size, scaled to {@link LONG_EDGE},
 * turned upright — re-encoding drops the tag, so a receipt would otherwise arrive on its side — and
 * written as a JPEG at {@link JPEG_QUALITY}, off the main thread.
 *
 * **Every request is answered, once, and never left hanging.** Whoever asked is waiting on a
 * promise — the camera button, with the slot the Jarvis server opened for this photo running out
 * behind it, and Jarvis told the camera is open. So a photo is answered with nothing when sir goes
 * back without one, when the camera app is missing, when a newer request takes over
 * ({@link awaitPhoto}), when this activity is torn down without an answer, and when
 * {@link GIVE_UP_AFTER_MS} passes with the camera still open — timed on the main looper, because
 * JavaScript's own timers stop while the app is behind the camera. A photo taken that cannot be made
 * ready to send is answered with {@link NOT_READABLE} instead, since sir did take one. Each request
 * carries a number ({@link REQUEST}) so an answer only ever reaches the request it is for.
 *
 * **It survives being recreated under the camera** — a rotation, a change of theme — by starting the
 * camera only on a first creation and keeping the file it is writing to across the rest.
 *
 * It starts in a task of its own (`taskAffinity=""` in the manifest), so that started from the
 * assistant's window it never brings the app's own activity forward behind it.
 */
class JarvisPhotoActivity : Activity() {

  /** Where the camera app writes the full-size photo. Kept across a recreation, which the camera can cause. */
  private var taken: File? = null

  /** When the camera was first opened, on the clock that keeps running in deep sleep. */
  private var openedAt = 0L

  private val deadline = Handler(Looper.getMainLooper())
  private val giveUp = Runnable { giveUpOnTheCamera() }

  /** Which request this photo answers. See {@link awaitPhoto}. */
  private val request: Int
    get() = intent.getIntExtra(REQUEST, 0)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    taken = savedInstanceState?.getString(STATE_TAKEN)?.let(::File)
    openedAt = savedInstanceState?.getLong(STATE_OPENED_AT) ?: SystemClock.elapsedRealtime()
    showing = WeakReference(this)
    deadline.postDelayed(giveUp, max(0L, GIVE_UP_AFTER_MS - (SystemClock.elapsedRealtime() - openedAt)))
    if (savedInstanceState == null) {
      startTheCameraApp()
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    taken?.let { outState.putString(STATE_TAKEN, it.path) }
    outState.putLong(STATE_OPENED_AT, openedAt)
  }

  override fun onDestroy() {
    deadline.removeCallbacks(giveUp)
    if (showing?.get() === this) {
      showing = null
    }
    // Torn down for good without an answer — cleared by a newer request, or by the system — is a
    // photo not taken. A recreation is not the end of it, and answers nothing.
    if (isFinishing) {
      deliver(request, null)
    }
    super.onDestroy()
  }

  /** The camera has been open longer than anyone is still waiting: close it, and say there is no photo. */
  private fun giveUpOnTheCamera() {
    Log.i(TAG, "Nobody took a photo in ${GIVE_UP_AFTER_MS / 1000} s; closing the camera.")
    finishActivity(TAKE_PHOTO)
    taken?.delete()
    finishWith(null)
  }

  private fun startTheCameraApp() {
    val directory = photoDirectory(this)
    // Whatever an earlier photo left here has been sent or given up on by now.
    directory.listFiles()?.forEach { it.delete() }

    val file = File(directory, "taken-${System.currentTimeMillis()}.jpg")
    taken = file
    val uri = FileProvider.getUriForFile(this, "$packageName$PROVIDER_SUFFIX", file)
    val capture =
      Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        .putExtra(MediaStore.EXTRA_OUTPUT, uri)
        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    // The grant travels with the clip data too, which is what some camera apps read it from.
    capture.clipData = ClipData.newRawUri("", uri)

    try {
      startActivityForResult(capture, TAKE_PHOTO)
    } catch (error: ActivityNotFoundException) {
      Log.w(TAG, "This phone has no camera app to take a photo with.", error)
      finishWith(null)
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != TAKE_PHOTO) {
      super.onActivityResult(requestCode, resultCode, data)
      return
    }
    deadline.removeCallbacks(giveUp)

    val photo = taken
    if (resultCode != RESULT_OK || photo == null || !photo.exists() || photo.length() == 0L) {
      photo?.delete()
      finishWith(null)
      return
    }

    Thread {
      val sized =
        try {
          makeReadyToSend(photo)
        } catch (error: IOException) {
          Log.w(TAG, "Could not make the photo ready to send.", error)
          null
        } catch (error: RuntimeException) {
          Log.w(TAG, "Could not make the photo ready to send.", error)
          null
        } finally {
          photo.delete()
        }
      runOnUiThread {
        if (sized != null) {
          finishWith(sized)
        } else {
          finishNotReadable()
        }
      }
    }.start()
  }

  /**
   * A photo was taken, and could not be made ready to send: said as {@link NOT_READABLE} rather than
   * as nothing, because sir did take one, and is waiting to hear what became of it.
   */
  private fun finishNotReadable() {
    deliver(request, NOT_READABLE)
    finish()
  }

  /**
   * Hands the photo over — or nothing — and gets out of the way.
   *
   * Nobody left to hand it to — the process was recreated under the camera, and whoever asked went
   * with it — and the photo is dropped here rather than left in the cache.
   */
  private fun finishWith(photo: File?) {
    if (!deliver(request, photo?.let { Uri.fromFile(it).toString() })) {
      photo?.delete()
    }
    finish()
  }

  companion object {
    private const val TAG = "JarvisAssistant"
    private const val TAKE_PHOTO = 1
    private const val STATE_TAKEN = "taken"
    private const val STATE_OPENED_AT = "openedAt"

    /** The extra saying which request a photo answers. */
    internal const val REQUEST = "request"

    /**
     * Handed over in place of a photo's URI when one was taken and could not be made ready to send.
     * Never a URI, which always starts `file://`. `index.ts` spells it the same way.
     */
    private const val NOT_READABLE = "notReadable"

    /**
     * How long the camera may stay open before the request is answered with nothing.
     *
     * Well inside the five minutes the upload slot lives (`UPLOAD_SLOT_MS` in the Jarvis server's
     * `vision/photos.ts`), which was opened when sir tapped the camera button: a photo taken at the
     * last moment here still has time to be made ready and sent before its slot closes. A camera left
     * open for longer than this is a phone put down rather than a shot being framed. Kept in step with
     * `PICKER_GIVE_UP_AFTER_MS` in `take-photo.web.ts`, the browser's bound.
     */
    private const val GIVE_UP_AFTER_MS = 110_000L

    /** Appended to the package name for the file provider's authority. The manifest spells it too. */
    private const val PROVIDER_SUFFIX = ".jarvisphotos"

    /** The longest edge a photo is sent at. Kept in step with `PHOTO_LONG_EDGE` in `photo-upload.ts`. */
    private const val LONG_EDGE = 1600

    /** JPEG quality, 0–100. Kept in step with `PHOTO_QUALITY` in `photo-upload.ts`. */
    private const val JPEG_QUALITY = 85

    /** The request waiting for a photo now, by number. Main thread only, like everything here. */
    private var waiting: Pair<Int, (String?) -> Unit>? = null

    /** How many requests there have been, which numbers the next. */
    private var requests = 0

    /** The photo activity on screen, if there is one, for a newer request to close. */
    private var showing: WeakReference<JarvisPhotoActivity>? = null

    /**
     * Says who to give the next photo to, and returns the number to start the activity with.
     *
     * A request already under way is abandoned: answered with nothing — its photo is not coming,
     * and a promise nobody settles is a camera button that never comes back — and its camera
     * closed, so two are never open at once.
     */
    internal fun awaitPhoto(receive: (String?) -> Unit): Int {
      waiting?.second?.invoke(null)
      waiting = null
      showing?.get()?.let { abandoned ->
        abandoned.finishActivity(TAKE_PHOTO)
        abandoned.finish()
      }
      requests += 1
      waiting = requests to receive
      return requests
    }

    /** Gives the photo to the request it is for, once. Says whether that request was still waiting. */
    internal fun deliver(request: Int, photo: String?): Boolean {
      val (waitingRequest, receive) = waiting ?: return false
      if (waitingRequest != request) {
        return false
      }
      waiting = null
      receive(photo)
      return true
    }

    /** The one directory photos pass through, in the cache: nothing here is meant to be kept. */
    private fun photoDirectory(context: Context): File = File(context.cacheDir, "jarvis-photos").apply { mkdirs() }

    /** Decodes, scales, turns upright and re-encodes. Throws if the camera left something that is not a photo. */
    private fun makeReadyToSend(photo: File): File {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(photo.path, bounds)
      val longest = max(bounds.outWidth, bounds.outHeight)
      if (longest <= 0) {
        throw IOException("The camera app left no readable photo.")
      }

      // Decode at the largest power of two that still leaves at least the long edge wanted, so a
      // twelve-megapixel photo is never held in memory whole.
      var sample = 1
      while (longest / (sample * 2) >= LONG_EDGE) {
        sample *= 2
      }
      val decoded =
        BitmapFactory.decodeFile(photo.path, BitmapFactory.Options().apply { inSampleSize = sample })
          ?: throw IOException("The camera app left no readable photo.")

      val scale = min(1f, LONG_EDGE.toFloat() / max(decoded.width, decoded.height))
      val turn = Matrix().apply {
        postScale(scale, scale)
        postRotate(uprightRotation(photo))
      }
      val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, turn, true)

      val sized = File(photo.parentFile, "shown-${System.currentTimeMillis()}.jpg")
      FileOutputStream(sized).use { output ->
        if (!upright.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) {
          throw IOException("The photo could not be written as a JPEG.")
        }
      }
      if (upright !== decoded) {
        upright.recycle()
      }
      decoded.recycle()
      return sized
    }

    /** How far the camera said to turn the photo to stand it up, in degrees. */
    private fun uprightRotation(photo: File): Float =
      when (ExifInterface(photo.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
  }
}
