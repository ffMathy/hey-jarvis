/**
 * The mark routing reads to know that an agent has started something that takes minutes.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createArtifact } from '../verticals/generative-ui/shortcuts.js';
import { createShortcut } from './shortcut-factory.js';
import { isSlowTask, markAsSlow } from './slow-tasks.js';
import { createTool } from './tool-factory.js';

function quickTool(id: string) {
  return createTool({
    id,
    description: 'Answers at once',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => ({}),
  });
}

describe('slow tasks', () => {
  it('knows a tool that was marked slow, and no other', () => {
    markAsSlow(quickTool('slowSpecTool'));

    expect(isSlowTask('slowSpecTool')).toBe(true);
    expect(isSlowTask('quickSpecTool')).toBe(false);
  });

  it('knows a slow workflow by the name an agent calls it', () => {
    markAsSlow({ id: 'slowSpecWorkflow' });

    expect(isSlowTask('workflow-slowSpecWorkflow')).toBe(true);
  });

  it('marks a shortcut onto a slow tool slow as well', () => {
    const slow = markAsSlow(quickTool('slowSpecUnderlying'));
    const shortcut = createShortcut({
      id: 'slowSpecShortcut',
      description: 'A shortcut',
      tool: slow,
      execute: async () => ({}),
    });

    expect(isSlowTask(shortcut.id)).toBe(true);
  });

  it('leaves a shortcut onto a quick tool alone', () => {
    const shortcut = createShortcut({
      id: 'quickSpecShortcut',
      description: 'A shortcut',
      tool: quickTool('quickSpecUnderlying'),
      execute: async () => ({}),
    });

    expect(isSlowTask(shortcut.id)).toBe(false);
  });

  it('counts building an artifact as slow, since it runs a Claude cloud session', () => {
    expect(isSlowTask(createArtifact.id)).toBe(true);
  });
});
