package expo.modules.jarvisassistant

import androidx.core.content.FileProvider

/**
 * Lends the camera app the one file it is to write Jarvis's photo into.
 *
 * A subclass only so the manifest can name a class nobody else declares: two libraries each
 * declaring `androidx.core.content.FileProvider` itself collide when their manifests are merged,
 * which is why expo-file-system ships a subclass of its own too.
 */
class JarvisPhotoProvider : FileProvider()
