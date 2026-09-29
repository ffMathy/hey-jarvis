/**
 * The parts of preference extraction that do not reach a model: the prompt, and the
 * short-circuit that keeps blank working memory from reaching one at all.
 */

import { describe, expect, it } from 'bun:test';
import { buildPreferenceExtractionPrompt, extractPreferences } from './preference-extraction.js';
import { PROMOTED_SUBSCRIPTION_SOURCE } from './preference-promotion.js';

describe('buildPreferenceExtractionPrompt', () => {
  it('carries the working memory and every existing subscription with its id and origin', () => {
    const prompt = buildPreferenceExtractionPrompt({
      workingMemory: '  - User wants to know about freezing temperatures\n',
      subscriptions: [
        {
          id: 'promoted-1',
          source: PROMOTED_SUBSCRIPTION_SOURCE,
          whenEvent: 'the outdoor temperature drops below freezing',
          thenAction: 'notify the user',
        },
        {
          id: 'user-1',
          source: 'user',
          whenEvent: 'the sun goes down',
          givenCondition: 'the lights are on',
          thenAction: 'close the blinds',
        },
      ],
    });

    expect(prompt).toContain('<notes>\n- User wants to know about freezing temperatures\n</notes>');
    expect(prompt).toContain('- id: promoted-1\n  origin: promoted from these notes');
    expect(prompt).toContain('- id: user-1\n  origin: registered by the user');
    expect(prompt).toContain('  given: the lights are on');
    expect(prompt).toContain('  given: (none)');
  });

  it('says so when nothing is subscribed yet', () => {
    const prompt = buildPreferenceExtractionPrompt({ workingMemory: 'notes', subscriptions: [] });

    expect(prompt).toContain('These subscriptions exist already:\n\n(none)');
  });
});

describe('extractPreferences', () => {
  it('finds nothing in blank working memory without asking a model', async () => {
    // No model is configured in the unit test environment, so reaching one would throw.
    expect(await extractPreferences({ workingMemory: null, subscriptions: [] })).toEqual([]);
    expect(await extractPreferences({ workingMemory: '   \n', subscriptions: [] })).toEqual([]);
  });
});
