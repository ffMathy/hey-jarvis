package expo.modules.jarvisassistant

import android.content.Intent
import android.net.Uri

/**
 * The URL that tells the app it was opened because the user summoned Jarvis,
 * rather than because they tapped the icon.
 *
 * The scheme has to stay in step with two other places: `scheme` in
 * `mobile/app.config.ts`, which is what makes the app's main activity answer it,
 * and `ASSIST_URL` in `mobile/src/assist-link.ts`, which is what reads it on the
 * other side. There is no way to share a constant across that boundary, so
 * `mobile/src/assist-link.contract.spec.ts` reads all three out of the sources
 * and fails if they disagree — drift here breaks nothing loudly, it just leaves
 * the gesture opening an app that waits to be asked a second time.
 */
internal const val ASSIST_URL = "heyjarvis://assist"

/**
 * Builds the intent that brings the conversation to the front.
 *
 * `setPackage` keeps the link inside this app: without it a URL this specific
 * would still go through the system's chooser on a device where something else
 * claims the scheme.
 */
internal fun createAssistIntent(packageName: String): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse(ASSIST_URL)).apply {
    setPackage(packageName)
    addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
    )
  }
