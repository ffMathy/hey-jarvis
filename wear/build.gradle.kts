// The same Android Gradle Plugin and Kotlin versions the phone app's generated
// build uses, so one Gradle cache serves both.
plugins {
  id("com.android.application") version "8.12.0" apply false
  id("org.jetbrains.kotlin.android") version "2.1.20" apply false
}
