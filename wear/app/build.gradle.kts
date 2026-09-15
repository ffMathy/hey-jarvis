import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.ffmathy.heyjarvis.wear"
  compileSdk = 36

  defaultConfig {
    // The phone app's package name, on purpose. The Wearable Data Layer only
    // connects a phone app and a watch app that share a package name and a
    // signing key, and the watch will need it to get its settings from the phone.
    applicationId = "com.ffmathy.heyjarvis"
    // Wear OS 3, the oldest release that still receives updates.
    minSdk = 30
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      // Signed with this machine's debug key, so it installs without a release
      // keystore. See wear/AGENTS.md for what that means across builds.
      signingConfig = signingConfigs.getByName("debug")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}
