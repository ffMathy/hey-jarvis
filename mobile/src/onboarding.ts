/**
 * The tour the app opens with the first time it is run, and what is on each step of it.
 *
 * Everything here is pure, and deliberately: no `react-native`, no `expo`, nothing that needs a
 * device. `bun test` cannot parse React Native's Flow types — see the note in
 * `watch-link.contract.spec.ts` — so the order of the steps, which of them this device has, and
 * where every link goes are decided here and merely drawn in `onboarding-screen.tsx`.
 *
 * **Why there is a tour at all.** The app used to open on a form asking for an API key and an
 * agent ID, which is a fair question to ask of somebody who already has both and an unanswerable
 * one for everybody else: nothing on that screen said what an ElevenLabs agent is, that Jarvis is
 * one, or that the agent is where the connections to everything else are made. Sample mode was
 * reachable from it, so there was a way to see the sphere, but no way to find out what the sphere
 * was for.
 */

/**
 * The steps, in the order they are walked.
 *
 * - `agent` — what an ElevenLabs agent is and what it can be wired up to, with the links to go
 *   and make one. Nothing is typed here; it exists so the next step is answerable.
 * - `credentials` — the API key and the agent ID, with the links to where each is found.
 * - `assistant` — the recommendation to make Jarvis the phone's assistant, and the button that
 *   opens the picker. Last, because it is the only step that sends the user out of the app, and
 *   asking before there is a Jarvis to summon would be asking them to set up a dead gesture.
 */
export const ONBOARDING_STEPS = ['agent', 'credentials', 'assistant'] as const;

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
   * Whether the credentials are already stored.
   *
   * True means the tour is being *resumed* rather than started: the credentials step saves as
   * soon as it validates, precisely so that the assistant step — which sends the user out to
   * Android's settings, from where the app may not come back alive — cannot cost them a pasted
   * key. So a tour that comes back to a phone that already has credentials picks up after them.
   */
  hasSettings: boolean;
}

/** The steps this device and this install actually have, in order. */
export function onboardingSteps(ground: OnboardingGround): readonly OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => (step === 'assistant' ? ground.canBeTheAssistant : !ground.hasSettings));
}

/**
 * Where the tour opens, or nothing if there is none left to walk.
 *
 * Nothing left is a real answer and not a mistake: a browser whose credentials were saved before
 * the tour finished has no step remaining, because the assistant step does not exist there. The
 * caller treats it as a tour already over.
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

/** How far along the tour is, for the "2 of 3" a wizard owes the person walking it. */
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

/** Somewhere the tour sends the user to get something it cannot give them itself. */
export interface OnboardingLink {
  /** A short name for it, used as a React key and as the test ID of the card. */
  id: string;
  /** What the link says. */
  label: string;
  /** Where it goes. Always ElevenLabs: nothing here should be a third party. */
  url: string;
  /** One line under it, saying what is on the other side. */
  hint: string;
}

/**
 * The links on the first step: where an account and an agent come from.
 *
 * The third one is the point of the step rather than an aside. An agent that only talks is a
 * novelty; an agent with tools is the thing this app exists to put a sphere in front of, and the
 * only place that wiring can be done is the ElevenLabs dashboard.
 */
export const AGENT_LINKS: readonly OnboardingLink[] = [
  {
    id: 'sign-up',
    label: 'Create an ElevenLabs account',
    url: 'https://elevenlabs.io/app/sign-up',
    hint: 'Free to start. The agent runs on their side, which is why this app needs to be told where to find it.',
  },
  {
    id: 'build-an-agent',
    label: 'Build an agent',
    url: 'https://elevenlabs.io/app/agents',
    hint: 'Give it a voice and a personality. You can keep editing it afterwards without touching this app.',
  },
  {
    id: 'agent-tools',
    label: 'Connect it to your own services',
    url: 'https://elevenlabs.io/docs/agents-platform/customization/tools',
    hint: 'Webhooks and MCP servers: how an agent reaches a calendar, a shopping list or a house full of lights.',
  },
];

/**
 * The links on the credentials step: where each of the two values is found.
 *
 * Both go to ElevenLabs rather than explaining it here, because both screens are theirs and they
 * move them around. What is worth saying in this app is the part they have no reason to say: make
 * a key for this app alone.
 */
export const CREDENTIAL_LINKS: readonly OnboardingLink[] = [
  {
    id: 'agent-id',
    label: 'Where the agent ID is',
    url: 'https://elevenlabs.io/docs/agents-platform/quickstart',
    hint: 'Open your agent in the dashboard. The ID is the last part of the address, and it starts with agent_.',
  },
  {
    id: 'api-key',
    label: 'Create an API key',
    url: 'https://elevenlabs.io/app/settings/api-keys',
    hint: 'Make one for this app alone, so that a lost phone means revoking one key rather than all of them.',
  },
];
