/**
 * The planner's labelling of how a request should be answered.
 *
 * What the model does with the instructions is the LLM eval's to judge; what is pinned here is the
 * contract around it: that every plan must carry a style, that only the four known ones are
 * accepted, and that the instructions describe each of them.
 */

import { describe, expect, it } from 'bun:test';
import { plannerInstructions, planSchema, RESPONSE_STYLES } from './planner.js';

describe('responseStyle', () => {
  it('is required on every plan, so a request is never answered in no particular way', () => {
    expect(planSchema.safeParse({ tasks: [], answers: [] }).success).toBe(false);
    expect(planSchema.safeParse({ responseStyle: 'command', tasks: [], answers: [] }).success).toBe(true);
  });

  it('accepts only the styles the closing instructions know how to speak', () => {
    expect(planSchema.safeParse({ responseStyle: 'monologue', tasks: [], answers: [] }).success).toBe(false);
  });

  it('is explained to the planner, one style at a time', () => {
    const instructions = plannerInstructions([]);

    for (const style of RESPONSE_STYLES) {
      expect(instructions).toContain(`\`${style}\``);
    }
    expect(instructions).toContain('where the value of the request lands');
  });
});
