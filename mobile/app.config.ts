import type { ExpoConfig } from 'expo/config';

/**
 * The Android app Jarvis answers from.
 *
 * There is no `plugins` entry for the assistant registration, on purpose. The
 * `modules/jarvis-assistant` local module is a Gradle library project, so the
 * manifest under `modules/jarvis-assistant/android/src/main` is merged into the
 * app's own during the build — the same way `expo-file-system` declares its
 * file provider. Everything the system needs in order to offer Jarvis in the
 * assistant picker is therefore declared next to the Kotlin that implements it,
 * rather than in a config plugin patching a generated file.
 */
const config: ExpoConfig = {
  name: 'Jarvis',
  slug: 'hey-jarvis',
  version: '0.1.0',
  orientation: 'portrait',
  // How the voice interaction session hands control back to the app. The
  // assistant is summoned from outside the app, so there has to be a URL that
  // reaches it: `heyjarvis://assist`.
  scheme: 'heyjarvis',
  userInterfaceStyle: 'dark',
  backgroundColor: '#05070d',
  // No iOS target. Apple has no equivalent of the assistant role — Siri cannot
  // be replaced — so it would ship something that cannot do the one thing this
  // app exists for.
  //
  // Web is here for a smaller reason, but a real one: the conversation is the
  // whole app apart from the assist gesture, and it runs in a browser on the
  // same `ConversationProvider` over the browser's own WebRTC. Taking over the
  // assist gesture stays Android's, and the app says so when it is on web rather
  // than leaving a button that cannot work.
  platforms: ['android', 'web'],
  web: {
    bundler: 'metro',
    output: 'single',
  },
  android: {
    package: 'com.ffmathy.heyjarvis',
    permissions: [
      // The conversation itself.
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      // WebRTC needs to know whether it is on wifi or cellular to pick a
      // candidate, and holds a wake lock so a sentence is not cut off by the
      // screen going to sleep.
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'android.permission.WAKE_LOCK',
      // Assistants are routinely summoned through a headset button, and the
      // audio has to follow the headset when they are.
      'android.permission.BLUETOOTH_CONNECT',
    ],
    // `@livekit/react-native` declares CAMERA in its own manifest because the
    // same module also does video calls. Jarvis never opens a camera, and a
    // permission nobody uses is a permission nobody can audit, so it is merged
    // straight back out again.
    blockedPermissions: ['android.permission.CAMERA'],
  },
  plugins: [
    'expo-dev-client',
    // Applies expo-secure-store's Auto Backup and data-extraction rules, which
    // keep its storage — where the ElevenLabs API key lives — out of cloud backups
    // and device-to-device transfers. Without them the encrypted entry is backed
    // up anyway: undecryptable elsewhere, since the keystore key does not travel,
    // but copied off the phone all the same.
    'expo-secure-store',
    // Writes the meta-data that LiveKit's own lifecycle listener reads at
    // startup to pick an audio mode. Without it the native audio session is set
    // up for media playback rather than a call: the microphone routes to the
    // earpiece, and Jarvis hears his own voice back.
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
  ],
};

export default config;
