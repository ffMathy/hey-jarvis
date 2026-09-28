/**
 * The path from a spoken request to a coding session: the session is started at once, with nothing
 * asked first — whatever only the user can decide, the session asks itself, along the way.
 *
 * The Claude Code session is spied on and recorded, so everything up to it — what it is told and
 * what the workflow reports — is the real workflow.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_SESSION_ID,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { isSlowTask } from '../../utils/slow-tasks.js';
import { startCodingSession } from './tools.js';
import { implementFeatureWorkflow } from './workflows.js';

const REQUEST = 'Remind me about tasks before they are due';

let codingTools: CodingToolRecorder | undefined;

function startRun() {
  codingTools = recordCodingTools();
  const mastra = new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { implementFeatureWorkflow },
  });
  return { recorder: codingTools, createRun: () => mastra.getWorkflow('implementFeatureWorkflow').createRun() };
}

afterEach(() => {
  codingTools?.restore();
  codingTools = undefined;
});

describe('implementFeatureWorkflow', () => {
  it('starts the coding session straight away, asking nothing first', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();

    const finished = await run.start({ inputData: { initialRequest: REQUEST, title: 'Task reminders' } });

    expect(finished.status).toBe('success');
    expect(recorder.startedSessions).toEqual([
      expect.objectContaining({ owner: 'ffMathy', repo: 'hey-jarvis', request: REQUEST, title: 'Task reminders' }),
    ]);
    if (finished.status === 'success') {
      expect(finished.result).toMatchObject({ success: true, sessionId: RECORDED_SESSION_ID, title: 'Task reminders' });
    }
  });

  it('is not marked slow, since it returns as soon as the session has started', () => {
    expect(isSlowTask('workflow-implementFeatureWorkflow')).toBe(false);
  });

  it('keeps a repository the request did name', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();

    await run.start({ inputData: { initialRequest: 'Add a dark mode', owner: 'someone', repository: 'their-app' } });

    expect(recorder.startedSessions[0]).toMatchObject({ owner: 'someone', repo: 'their-app' });
  });

  it('says the session did not start, and why, when it could not be started', async () => {
    const { createRun } = startRun();
    codingTools?.restore();
    const failing = spyOn(startCodingSession, 'execute').mockImplementation(async () => ({
      success: false,
      message: 'The host is down',
    }));

    try {
      const finished = await (await createRun()).start({ inputData: { initialRequest: REQUEST } });

      expect(finished.status).toBe('success');
      if (finished.status === 'success') {
        expect(finished.result).toMatchObject({
          success: false,
          message: 'The Claude Code session did not start: The host is down',
        });
      }
    } finally {
      failing.mockRestore();
    }
  });
});
