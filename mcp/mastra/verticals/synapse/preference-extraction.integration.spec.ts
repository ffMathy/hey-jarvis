import { describe, expect, it } from 'bun:test';
import { extractPreferences } from './preference-extraction.js';
import { PROMOTED_SUBSCRIPTION_SOURCE } from './preference-promotion.js';

/**
 * Preference extraction against a real model.
 *
 * The deterministic half of promotion is covered offline in `preference-promotion.spec.ts`.
 * What only a real model can show is whether it reads a standing preference out of
 * working-memory prose, leaves plain facts alone, and points at a subscription that
 * already expresses a preference instead of restating it.
 */
describe('preference extraction', () => {
  const workingMemory = `# User preferences
- Name: Mathias
- Vegetarian
- Wants to know about freezing temperatures, so plants can be brought in
- Tell him when mom texts about dinner`;

  it('reads the standing preferences and ignores plain facts', async () => {
    const preferences = await extractPreferences({ workingMemory, subscriptions: [] });

    expect(preferences.length).toBeGreaterThanOrEqual(1);
    expect(preferences.length).toBeLessThanOrEqual(3);
    expect(preferences.some((preference) => /freez/i.test(preference.whenEvent))).toBe(true);
    expect(preferences.some((preference) => /vegetarian/i.test(preference.whenEvent))).toBe(false);

    console.log('✅ Extracted preferences');
    for (const preference of preferences) {
      console.log(`   - WHEN ${preference.whenEvent} THEN ${preference.thenAction}`);
    }
  }, 90000);

  it('points at the promoted subscription that already expresses a preference', async () => {
    const preferences = await extractPreferences({
      workingMemory,
      subscriptions: [
        {
          id: 'promoted-freezing',
          source: PROMOTED_SUBSCRIPTION_SOURCE,
          whenEvent: 'the outdoor temperature drops below freezing',
          thenAction: 'notify the user so the plants can be brought in',
        },
      ],
    });

    const freezing = preferences.find((preference) => /freez/i.test(preference.whenEvent));
    expect(freezing?.existingSubscriptionId).toBe('promoted-freezing');
  }, 90000);
});
