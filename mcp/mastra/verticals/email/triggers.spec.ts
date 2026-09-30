/**
 * Email triggers: which emails start a trigger's workflow, and in particular when a trigger's
 * fallback filter is asked. It is asked only for the sender's emails that the subject filter
 * missed, so adding one never delays, or changes, a match the subject already made.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { clearEmailTriggers, processEmailTriggers, registerEmailTrigger, type TriggerableEmail } from './triggers.js';

const SENDER = 'orders@shop.example';
const KNOWN_SUBJECT = 'Your order has changed';

const startedSubjects: string[] = [];

const recordingWorkflow = createWorkflow({
  id: 'recordingTriggerWorkflow',
  inputSchema: z.object({ email: z.object({ subject: z.string() }).loose() }),
  outputSchema: z.object({}),
})
  .then(
    createStep({
      id: 'record-email',
      description: 'Records the subject of the email that started it',
      inputSchema: z.object({ email: z.object({ subject: z.string() }).loose() }),
      outputSchema: z.object({}),
      execute: async ({ inputData }) => {
        startedSubjects.push(inputData.email.subject);
        return {};
      },
    }),
  )
  .commit();

function email(subject: string, sender = SENDER): TriggerableEmail {
  return {
    id: subject,
    subject,
    bodyPreview: 'Two items were replaced',
    body: { contentType: 'text', content: 'Two items were replaced' },
    from: { name: 'Shop', address: sender },
    receivedDateTime: '2026-09-30T08:00:00Z',
  };
}

/** Registers the trigger, with a fallback that answers `fallbackAnswer` and records what it was asked. */
function registerTrigger(fallbackAnswer: () => Promise<boolean>) {
  const askedSubjects: string[] = [];
  const triggerId = registerEmailTrigger({
    sender: SENDER,
    subjectFilter: (subject) => subject.includes(KNOWN_SUBJECT),
    fallbackFilter: async (askedEmail) => {
      askedSubjects.push(askedEmail.subject);
      return await fallbackAnswer();
    },
    workflow: recordingWorkflow,
  });
  return { triggerId, askedSubjects };
}

afterEach(() => {
  clearEmailTriggers();
  startedSubjects.length = 0;
});

describe('processEmailTriggers with a fallback filter', () => {
  it('matches the known subject without asking the fallback', async () => {
    const { triggerId, askedSubjects } = registerTrigger(async () => false);

    expect(await processEmailTriggers(email(KNOWN_SUBJECT))).toEqual([triggerId]);
    expect(askedSubjects).toEqual([]);
    expect(startedSubjects).toEqual([KNOWN_SUBJECT]);
  });

  it('asks the fallback about a reworded subject, and starts the workflow when it says yes', async () => {
    const { triggerId, askedSubjects } = registerTrigger(async () => true);

    expect(await processEmailTriggers(email('Changes to your order'))).toEqual([triggerId]);
    expect(askedSubjects).toEqual(['Changes to your order']);
    expect(startedSubjects).toEqual(['Changes to your order']);
  });

  it('does not match when the fallback says no, or throws', async () => {
    registerTrigger(async () => false);
    expect(await processEmailTriggers(email('Your receipt'))).toEqual([]);

    clearEmailTriggers();
    registerTrigger(async () => {
      throw new Error('Jev is down');
    });
    expect(await processEmailTriggers(email('Changes to your order'))).toEqual([]);
    expect(startedSubjects).toEqual([]);
  });

  it('never asks the fallback about another sender', async () => {
    const { askedSubjects } = registerTrigger(async () => true);

    expect(await processEmailTriggers(email('Changes to your order', 'someone@else.example'))).toEqual([]);
    expect(askedSubjects).toEqual([]);
  });
});
