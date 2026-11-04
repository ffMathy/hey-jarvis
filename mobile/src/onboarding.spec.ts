import { describe, expect, it } from 'bun:test';
import {
  firstOnboardingStep,
  type OnboardingGround,
  onboardingProgress,
  onboardingSteps,
  stepAfterOnboardingStep,
  stepBeforeOnboardingStep,
} from './onboarding';

/** A phone on its first run: every step, not paired. */
const FIRST_RUN: OnboardingGround = { canBeTheAssistant: true, isPaired: false };

/** The same tour in a browser, which has no assistant role to offer Jarvis. */
const IN_A_BROWSER: OnboardingGround = { canBeTheAssistant: false, isPaired: false };

/** A phone that was paired and came back before the tour was over. */
const RESUMED: OnboardingGround = { canBeTheAssistant: true, isPaired: true };

describe('the shape of the tour', () => {
  it('pairs with the Jarvis server first, and asks for the assistant role last', () => {
    // The last step sends the user out to Android's settings to set up a gesture that would summon
    // nothing until this device is paired.
    expect(onboardingSteps(FIRST_RUN)).toEqual(['server', 'assistant']);
  });

  it('leaves the assistant step out where there is no assistant role to hold', () => {
    expect(onboardingSteps(IN_A_BROWSER)).toEqual(['server']);
  });

  it('picks up after the server when the device is already paired', () => {
    // Not a shortcut: the pairing is kept the moment it arrives, so a tour that is resumed has
    // genuinely been through it. Asking again would pair a device that is paired.
    expect(onboardingSteps(RESUMED)).toEqual(['assistant']);
    expect(firstOnboardingStep(RESUMED)).toBe('assistant');
  });

  it('has nothing left to walk in a browser that is already paired', () => {
    // The one combination with no steps in it, and the caller reads it as a tour already over
    // rather than as a mistake.
    expect(onboardingSteps({ canBeTheAssistant: false, isPaired: true })).toEqual([]);
    expect(firstOnboardingStep({ canBeTheAssistant: false, isPaired: true })).toBeUndefined();
  });
});

describe('walking it', () => {
  it('goes forwards to the end and then says so', () => {
    expect(firstOnboardingStep(FIRST_RUN)).toBe('server');
    expect(stepAfterOnboardingStep('server', FIRST_RUN)).toBe('assistant');
    // Nothing after the last step is how the screen knows the tour is finished rather than stuck.
    expect(stepAfterOnboardingStep('assistant', FIRST_RUN)).toBeUndefined();
  });

  it('ends with the pairing in a browser, where there is no second step', () => {
    expect(stepAfterOnboardingStep('server', IN_A_BROWSER)).toBeUndefined();
  });

  it('goes backwards, and offers nothing before the first step', () => {
    expect(stepBeforeOnboardingStep('assistant', FIRST_RUN)).toBe('server');
    expect(stepBeforeOnboardingStep('server', FIRST_RUN)).toBeUndefined();
  });

  it('answers nothing for a step this device does not have', () => {
    // The screen freezes the ground when it opens, so it should never ask — but answering with
    // the first step instead of nothing would silently restart a tour rather than end it.
    expect(stepAfterOnboardingStep('assistant', IN_A_BROWSER)).toBeUndefined();
    expect(stepBeforeOnboardingStep('assistant', IN_A_BROWSER)).toBeUndefined();
    expect(stepBeforeOnboardingStep('server', RESUMED)).toBeUndefined();
  });

  it('counts the steps it actually has, not the ones it might have had', () => {
    expect(onboardingProgress('server', FIRST_RUN)).toEqual({ position: 1, total: 2 });
    expect(onboardingProgress('assistant', FIRST_RUN)).toEqual({ position: 2, total: 2 });
    // One step in a browser. A count that promised a second step nobody can reach is worse than
    // no count at all.
    expect(onboardingProgress('server', IN_A_BROWSER)).toEqual({ position: 1, total: 1 });
    expect(onboardingProgress('assistant', RESUMED)).toEqual({ position: 1, total: 1 });
  });
});
