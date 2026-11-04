/**
 * The tour the app opens with the first time it is run, and what is on each step of it.
 *
 * Everything here is pure, and deliberately: no `react-native`, no `expo`, nothing that needs a
 * device. `bun test` cannot parse React Native's Flow types — see the note in
 * `watch-link.contract.spec.ts` — so the order of the steps and which of them this device has are
 * decided here and merely drawn in `onboarding-screen.tsx`.
 *
 * **Why there is a tour at all.** Setting Jarvis up is one thing — pairing this device with sir's
 * own Jarvis server — but a field asking for a server's address is an unanswerable question to
 * somebody who has not been told that Jarvis lives on that server. And on a phone there is a second
 * thing worth doing that no screen in the app would otherwise mention: handing Jarvis the
 * assistant role.
 */

/**
 * The steps, in the order they are walked.
 *
 * - `server` — what the Jarvis server is, its address, and pairing this device with it. Pairing
 *   is what completes the step: the server holds the ElevenLabs key and starts every conversation,
 *   so there is nothing else to type in, here or anywhere.
 * - `assistant` — the recommendation to make Jarvis the phone's assistant, and the button that
 *   opens the picker. Last, because it is the only step that sends the user out of the app, and
 *   asking before there is a Jarvis to summon would be asking them to set up a dead gesture.
 *
 * It used to open on two steps for an ElevenLabs key — what an agent is, then the key and the agent
 * ID — which no app needs any more: the server holds both.
 */
export const ONBOARDING_STEPS = ['server', 'assistant'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What this device and this install make of the tour. */
export interface OnboardingGround {
  /**
   * Whether there is an assistant role here for Jarvis to hold.
   *
   * Android, in other words. A browser has no assistant gesture and no picker to send anyone to,
   * so the last step would be a recommendation nobody could act on.
   */
  canBeTheAssistant: boolean;
  /**
   * Whether this device is already paired with the Jarvis server.
   *
   * True means the tour is being *resumed* rather than started: the pairing is kept the moment it
   * arrives, precisely so that the assistant step — which sends the user out to Android's settings,
   * from where the app may not come back alive — cannot cost them it. So a tour that comes back to a
   * paired phone picks up after the server step.
   */
  isPaired: boolean;
}

/** The steps this device and this install actually have, in order. */
export function onboardingSteps(ground: OnboardingGround): readonly OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => (step === 'assistant' ? ground.canBeTheAssistant : !ground.isPaired));
}

/**
 * Where the tour opens, or nothing if there is none left to walk.
 *
 * Nothing left is a real answer and not a mistake: a paired browser has no step remaining, because
 * the assistant step does not exist there. The caller treats it as a tour already over.
 */
export function firstOnboardingStep(ground: OnboardingGround): OnboardingStep | undefined {
  return onboardingSteps(ground)[0];
}

/** The step after this one, or nothing when this was the last — which is how the tour ends. */
export function stepAfterOnboardingStep(step: OnboardingStep, ground: OnboardingGround): OnboardingStep | undefined {
  const steps = onboardingSteps(ground);
  const at = steps.indexOf(step);
  return at === -1 ? undefined : steps[at + 1];
}

/** The step before this one, or nothing when this was the first — which is why Back is not offered. */
export function stepBeforeOnboardingStep(step: OnboardingStep, ground: OnboardingGround): OnboardingStep | undefined {
  const steps = onboardingSteps(ground);
  const at = steps.indexOf(step);
  return at <= 0 ? undefined : steps[at - 1];
}

/** How far along the tour is, for the "1 of 2" a wizard owes the person walking it. */
export interface OnboardingProgress {
  /** Which step this is, counting from one. */
  position: number;
  /** How many there are on this device. */
  total: number;
}

export function onboardingProgress(step: OnboardingStep, ground: OnboardingGround): OnboardingProgress {
  const steps = onboardingSteps(ground);
  return { position: steps.indexOf(step) + 1, total: steps.length };
}
