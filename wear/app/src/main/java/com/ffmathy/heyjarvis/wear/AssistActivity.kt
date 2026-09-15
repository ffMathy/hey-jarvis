package com.ffmathy.heyjarvis.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.TextView
import java.time.LocalTime
import java.time.format.DateTimeFormatter

private const val TAG = "JarvisWear"

// The framework has this action but keeps its `Intent` constant out of the
// public SDK, so it is spelled out. It is the one the manifest also declares.
private const val ACTION_VOICE_ASSIST = "android.intent.action.VOICE_ASSIST"

/**
 * A prototype with one question to answer: does the watch hand its assistant
 * gesture to Jarvis?
 *
 * There is no conversation here yet. The screen says how this activity was
 * opened — by the assistant gesture, or from the app list — and when, so pressing
 * the button on a real watch answers the question without a cable attached. The
 * same line goes to logcat under `JarvisWear`, for when one is.
 */
class AssistActivity : Activity() {

  private lateinit var status: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    status = TextView(this).apply {
      gravity = Gravity.CENTER
      textSize = 16f
      // Round screens clip the corners, so the text keeps well clear of them.
      val inset = (resources.displayMetrics.widthPixels * 0.15).toInt()
      setPadding(inset, inset, inset, inset)
    }
    setContentView(status)

    show(intent)
  }

  // `singleTask`: a second summoning arrives here rather than as a new activity,
  // and has to update the screen, or it would look as if the button did nothing.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    show(intent)
  }

  private fun show(intent: Intent?) {
    val trigger = describeTrigger(intent?.action)
    val time = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"))

    status.text = "Jarvis\n\nOpened by $trigger\nat $time"
    Log.i(TAG, "Opened by $trigger (action=${intent?.action})")
  }
}

/** Says, in words, what opened the activity. */
private fun describeTrigger(action: String?): String =
  when (action) {
    Intent.ACTION_ASSIST -> "the assistant gesture (ASSIST)"
    ACTION_VOICE_ASSIST -> "the assistant gesture (VOICE_ASSIST)"
    Intent.ACTION_MAIN -> "the app list"
    null -> "nothing named"
    else -> action
  }
