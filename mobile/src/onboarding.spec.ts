import { describe, expect, it } from 'bun:test';
import {
  AGENT_LINKS,
  CREDENTIAL_LINKS,
  firstOnboardingStep,
  type OnboardingGround,
  onboardingProgress,
  onboardingSteps,
  stepAfterOnboardingStep,
  stepBeforeOnboardingStep,
} from './onboarding';

/** A phone on its first run: every step, nothing stored. */
const FIRST_RUN: OnboardingGround = { canBeTheAssistant: true, hasSettings: false };

/** The same tour in a browser, which has no assistant role to offer Jarvis. */
const IN_A_BROWSER: OnboardingGround = { canBeTheAssistant: false, hasSettings: false };

/** A phone that saved its credentials and came back before the tour was over. */
const RESUMED: OnboardingGround = { canBeTheAssistant: true, hasSettings: true };

describe('the shape of the tour', () => {
  it('explains agents before asking for credentials, and asks for the assistant role last', () => {
    // The order is the argument of the whole screen: the credentials step is unanswerable until
    // the first one has been read, and the last one sends the user out to Android's settings to
    // set up a gesture that would summon nothing until the other two are done.
    expect(onboardingSteps(FIRST_RUN)).toEqual(['agent', 'credentials', 'assistant']);
  });

  it('leaves the assistant step out where there is no assistant role to hold', () => {
    expect(onboardingSteps(IN_A_BROWSER)).toEqual(['agent', 'credentials']);
  });

  it('picks up after the credentials when they are already saved', () => {
    // Not a shortcut: the credentials step saves the moment the two values parse, so a tour that
    // is resumed has genuinely been through it. Asking again would ask for a key already held.
    expect(onboardingSteps(RESUMED)).toEqual(['assistant']);
    expect(firstOnboardingStep(RESUMED)).toBe('assistant');
  });

  it('has nothing left to walk in a browser whose credentials are already saved', () => {
    // The one combination with no steps in it, and the caller reads it as a tour already over
    // rather than as a mistake.
    expect(onboardingSteps({ canBeTheAssistant: false, hasSettings: true })).toEqual([]);
    expect(firstOnboardingStep({ canBeTheAssistant: false, hasSettings: true })).toBeUndefined();
  });
});

describe('walking it', () => {
  it('goes forwards to the end and then says so', () => {
    expect(firstOnboardingStep(FIRST_RUN)).toBe('agent');
    expect(stepAfterOnboardingStep('agent', FIRST_RUN)).toBe('credentials');
    expect(stepAfterOnboardingStep('credentials', FIRST_RUN)).toBe('assistant');
    // Nothing after the last step is how the screen knows the tour is finished rather than stuck.
    expect(stepAfterOnboardingStep('assistant', FIRST_RUN)).toBeUndefined();
  });

  it('ends after the credentials in a browser, where there is no step three', () => {
    expect(stepAfterOnboardingStep('credentials', IN_A_BROWSER)).toBeUndefined();
  });

  it('goes backwards, and offers nothing before the first step', () => {
    expect(stepBeforeOnboardingStep('credentials', FIRST_RUN)).toBe('agent');
    expect(stepBeforeOnboardingStep('assistant', FIRST_RUN)).toBe('credentials');
    expect(stepBeforeOnboardingStep('agent', FIRST_RUN)).toBeUndefined();
  });

  it('answers nothing for a step this device does not have', () => {
    // The screen freezes the ground when it opens, so it should never ask — but answering with
    // the first step instead of nothing would silently restart a tour rather than end it.
    expect(stepAfterOnboardingStep('assistant', IN_A_BROWSER)).toBeUndefined();
    expect(stepBeforeOnboardingStep('assistant', IN_A_BROWSER)).toBeUndefined();
  });

  it('counts the steps it actually has, not the ones it might have had', () => {
    expect(onboardingProgress('agent', FIRST_RUN)).toEqual({ position: 1, total: 3 });
    expect(onboardingProgress('assistant', FIRST_RUN)).toEqual({ position: 3, total: 3 });
    // "Step 2 of 2" in a browser. A count that promised a third step nobody can reach is worse
    // than no count at all.
    expect(onboardingProgress('credentials', IN_A_BROWSER)).toEqual({ position: 2, total: 2 });
    expect(onboardingProgress('assistant', RESUMED)).toEqual({ position: 1, total: 1 });
  });
});

describe('the links it sends people to', () => {
  const links = [...AGENT_LINKS, ...CREDENTIAL_LINKS];

  it('has something to say about each of them', () => {
    // A link with no hint is a button whose label is the only clue what it does, and these open
    // somebody's browser. Every one of them says what is on the other side.
    for (const link of links) {
      expect(link.label.length, `${link.id} should have a label`).toBeGreaterThan(0);
      expect(link.hint.length, `${link.id} should say what is on the other side`).toBeGreaterThan(0);
    }
  });

  it('goes to ElevenLabs over HTTPS, and nowhere else', () => {
    // Nothing in the tour should send anyone to a third party, and nothing should open a URL this
    // app cannot vouch for — these are the addresses of an account and an API key.
    for (const link of links) {
      const { protocol, hostname } = new URL(link.url);
      expect(protocol, link.id).toBe('https:');
      expect(hostname, link.id).toBe('elevenlabs.io');
    }
  });

  it('names each one once, so a card cannot be drawn twice or keyed wrongly', () => {
    expect(new Set(links.map((link) => link.id)).size).toBe(links.length);
    expect(new Set(links.map((link) => link.url)).size).toBe(links.length);
  });

  it('offers an account, an agent, and the tools that make an agent worth having', () => {
    // The third link is the point of the first step rather than an aside: an agent that only
    // talks is a novelty, and the wiring that makes it an assistant is done on their site.
    expect(AGENT_LINKS.map((link) => link.id)).toEqual(['sign-up', 'build-an-agent', 'agent-tools']);
  });

  it('offers both of the two values the next step asks for', () => {
    expect(CREDENTIAL_LINKS.map((link) => link.id)).toEqual(['agent-id', 'api-key']);
  });
});
