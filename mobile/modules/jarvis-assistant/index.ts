import { requireOptionalNativeModule } from 'expo';

/**
 * Which settings screen {@link openAssistantSettings} managed to reach.
 *
 * Worth distinguishing, because each one needs different words afterwards:
 * "Assist & voice input" puts the user one tap from the picker, the default apps
 * list two, and the top of Settings leaves them to find it.
 */
export type AssistantSettingsScreen = 'voice-input' | 'default-apps' | 'settings';

interface JarvisAssistantNativeModule {
  isAssistantRoleHeld(): boolean;
  isVoiceInteractionServiceActive(): boolean;
  canReachAssistantSettings(): boolean;
  openAssistantSettings(): AssistantSettingsScreen;
  dismissAssistantWindow(): boolean;
}

/**
 * Optional rather than required, so the app still boots where the native module
 * is absent — most usefully under a bundler or a test runner, neither of which
 * has an Android runtime to link it against. Every reader below treats a missing
 * module as "Jarvis is not the assistant", which is the truth in that situation.
 */
const nativeModule = requireOptionalNativeModule<JarvisAssistantNativeModule>('JarvisAssistant');

/** How the system is currently set up to summon Jarvis. */
export interface AssistantRegistration {
  /** Whether Jarvis is the assistant the phone summons. */
  roleHeld: boolean;
  /**
   * Whether the system drives Jarvis through the full voice interaction session.
   *
   * False while `roleHeld` is true is a real state rather than a contradiction:
   * some devices — Android Go among them — only ever send the cut-down assist
   * intent. Jarvis still opens; it just cannot appear over the app the user was
   * already in.
   */
  voiceInteractionActive: boolean;
  /** Whether this device has an assistant picker to send the user to at all. */
  settingsReachable: boolean;
}

/** Asks the system how Jarvis is currently registered. */
export function readAssistantRegistration(): AssistantRegistration {
  if (!nativeModule) {
    return { roleHeld: false, voiceInteractionActive: false, settingsReachable: false };
  }

  return {
    roleHeld: nativeModule.isAssistantRoleHeld(),
    voiceInteractionActive: nativeModule.isVoiceInteractionServiceActive(),
    settingsReachable: nativeModule.canReachAssistantSettings(),
  };
}

/**
 * Sends the user to the screen where the assistant is chosen.
 *
 * There is nothing to await. Android does not let an app request the assistant
 * role directly — the role is marked not requestable, so the API that looks like
 * it would ask shows nothing at all — which means the choice happens on a screen
 * this app does not own. The caller re-reads
 * {@link readAssistantRegistration} when the app returns to the foreground.
 */
export function openAssistantSettings(): AssistantSettingsScreen {
  if (!nativeModule) {
    throw new Error('The assistant module is not available in this build.');
  }

  return nativeModule.openAssistantSettings();
}

/**
 * Closes the window the assistant gesture opened, if that is where this is running.
 *
 * Summoned, the app is drawn into the session's own window rather than its own — so leaving is
 * not a matter of changing screens, it is retracting the window, and only the system can do that.
 * Returns false when there is no such window, which is every other way the app can be open; the
 * caller then leaves by changing screens as usual.
 */
export function dismissAssistantWindow(): boolean {
  return nativeModule?.dismissAssistantWindow() ?? false;
}
