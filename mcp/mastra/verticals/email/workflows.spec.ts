import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import * as realHumanInTheLoopAgents from '../human-in-the-loop/agents.js';
import * as realEmailTools from './tools.js';

/**
 * Resuming a run from a reply is the only part of the human-in-the-loop loop that lives
 * in the email vertical, and the only part with a real inbox on one side and a real
 * mailbox on the other. Both are replaced here: `sendEmail` records instead of calling
 * Microsoft Graph, and the parsing agent returns a staged answer instead of reaching a
 * model. Everything between them -- the subject token, the storage lookup, the suspended
 * step, the sender check -- is the real thing.
 *
 * The rest of both modules is spread back in because `mock.module` is process-global in
 * Bun and other spec files share this process.
 */
interface SentEmail {
  subject: string;
  bodyContent: string;
  toRecipients: string[];
}

const sentEmails: SentEmail[] = [];

mock.module('./tools.js', () => ({
  ...realEmailTools,
  sendEmail: {
    id: 'sendEmail',
    inputSchema: realEmailTools.sendEmail.inputSchema,
    outputSchema: realEmailTools.sendEmail.outputSchema,
    execute: async (inputData: SentEmail) => {
      sentEmails.push(inputData);
      return {
        // What the real tool returns: Graph's sendMail answers 202 with no body.
        messageId: 'sent',
        subject: inputData.subject,
        success: true,
        message: 'Email sent successfully',
      };
    },
  },
}));

const parsedReplyBodies: string[] = [];
let stagedAnswer: unknown;
let parseFailure: Error | undefined;
let parserAnswersForThisFile = false;

// Captured before the mock is registered: registering it rewrites the module namespace in
// place, so reading the export afterwards would find the stand-in.
const realParseEmailReply = realHumanInTheLoopAgents.parseEmailReply;

// `mock.module` is process-global, so this stand-in answers only while a test in this file
// is running; `agents.spec.ts` tests the real `parseEmailReply` in the same process.
mock.module('../human-in-the-loop/agents.js', () => ({
  ...realHumanInTheLoopAgents,
  parseEmailReply: async <TResponseSchema extends z.ZodObject<z.ZodRawShape>>(request: {
    question: string;
    replyBody: string;
    responseSchema: TResponseSchema;
  }) => {
    if (!parserAnswersForThisFile) {
      return await realParseEmailReply(request);
    }

    parsedReplyBodies.push(request.replyBody);
    if (parseFailure) {
      throw parseFailure;
    }
    return request.responseSchema.parse(stagedAnswer);
  },
}));

const {
  buildFormRequestSubject,
  getSendEmailAndAwaitResponseWorkflow,
  humanInTheLoopDemoWorkflow,
  parseFormRequestSubject,
} = await import('../human-in-the-loop/workflows.js');
const { formRepliesDetectionWorkflow } = await import('./workflows.js');

/** Narrows a workflow result so the status-specific fields are reachable. */
function assertStatus<TResult extends { status: string }, TStatus extends TResult['status']>(
  result: TResult,
  status: TStatus,
): asserts result is Extract<TResult, { status: TStatus }> {
  expect(result.status).toBe(status);
}

const approvalResponseSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
});

const awaitApprovalWorkflow = getSendEmailAndAwaitResponseWorkflow('emailReplyUnderTest', approvalResponseSchema);

/**
 * A suspended run that is not waiting for an email, used to check that the reply handler
 * looks at what a run is suspended on rather than resuming anything it happens to find.
 */
const awaitSomethingElseWorkflow = createWorkflow({
  id: 'awaitSomethingElseWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
})
  .then(
    createStep({
      id: 'await-something-else',
      description: 'Suspends on a step that has nothing to do with email',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      resumeSchema: z.object({}),
      suspendSchema: z.object({}),
      execute: async ({ resumeData, suspend }) => resumeData ?? (await suspend({})),
    }),
  )
  .commit();

/**
 * Two questions asked at once.
 *
 * A run can hold more than one suspension, and this is the shape that produces it. It
 * exists because the reply handler used to ask the state reader for "the" suspended step,
 * which is defined as the first of them: every reply was offered to whichever sorted
 * first, so the other question could never be answered by email at all.
 */
const askTwoAtOnceWorkflow = createWorkflow({
  id: 'askTwoAtOnceWorkflow',
  inputSchema: z.object({ recipientEmail: z.string(), question: z.string() }),
  outputSchema: z.object({}).loose(),
})
  .parallel([
    getSendEmailAndAwaitResponseWorkflow('firstOfTwo', approvalResponseSchema),
    getSendEmailAndAwaitResponseWorkflow('secondOfTwo', approvalResponseSchema),
  ])
  .commit();

const RESUME_FAILURE_MESSAGE = 'the ledger refused the approval';

/**
 * A run that accepts the reply and then dies on the next step, so the resume comes back
 * `failed`. The reason has to survive the trip: Mastra serialises the error before the
 * result leaves the engine, so reading `.message` straight off it is reading a field of
 * whatever shape happened to come back.
 */
const failsAfterReplyWorkflow = createWorkflow({
  id: 'failsAfterReplyWorkflow',
  inputSchema: z.object({ recipientEmail: z.string(), question: z.string() }),
  outputSchema: z.object({}),
})
  .then(getSendEmailAndAwaitResponseWorkflow('failingUnderTest', approvalResponseSchema))
  .then(
    createStep({
      id: 'explode-once-the-answer-is-in',
      description: 'Throws, so resuming this run reports a failure rather than a refusal',
      inputSchema: z.object({ senderEmail: z.string(), response: approvalResponseSchema }),
      outputSchema: z.object({}),
      execute: async () => {
        throw new Error(RESUME_FAILURE_MESSAGE);
      },
    }),
  )
  .commit();

// The state the form replies workflow builds up before `process-form-replies` reads it.
const emailStateSchema = z
  .object({
    newEmails: z.array(z.unknown()).default([]),
    isFirstCheck: z.boolean().default(false),
  })
  .partial();

const formReplyHarness = createWorkflow({
  id: 'formReplyHarness',
  inputSchema: z.object({ emailCount: z.number(), isFirstCheck: z.boolean() }),
  outputSchema: z.object({
    emailsProcessed: z.number(),
    formRepliesFound: z.number(),
    workflowsResumed: z.number(),
    repliesRejected: z.number(),
    errors: z.array(z.string()),
  }),
  stateSchema: emailStateSchema,
})
  .then(formRepliesDetectionWorkflow.steps['process-form-replies'])
  .commit();

const mastra = new Mastra({
  workflows: {
    awaitApprovalWorkflow,
    awaitSomethingElseWorkflow,
    failsAfterReplyWorkflow,
    askTwoAtOnceWorkflow,
    humanInTheLoopDemoWorkflow,
    formReplyHarness,
  },
});

let nextEmailId = 0;

function inboundReply({
  subject,
  from,
  content = '',
  preview = '',
}: {
  subject: string;
  from: string;
  content?: string;
  preview?: string;
}) {
  nextEmailId += 1;
  return {
    id: `email-${nextEmailId}`,
    subject,
    bodyPreview: preview,
    body: { contentType: 'text', content },
    from: { name: from, address: from },
    receivedDateTime: '2026-08-20T09:00:00Z',
    isRead: false,
    hasAttachments: false,
    isDraft: false,
  };
}

async function processReplies(emails: ReturnType<typeof inboundReply>[]) {
  const run = await mastra.getWorkflow('formReplyHarness').createRun();
  const result = await run.start({
    inputData: { emailCount: emails.length, isFirstCheck: false },
    initialState: { newEmails: emails, isFirstCheck: false },
  });

  assertStatus(result, 'success');
  return result.result;
}

async function startPendingApproval(recipientEmail: string) {
  const run = await mastra.getWorkflow('awaitApprovalWorkflow').createRun();
  const started = await run.start({ inputData: { recipientEmail, question: 'Approve the budget?' } });
  assertStatus(started, 'suspended');
  return run;
}

/**
 * The subject a mail client puts on a reply to the request email at `index` in the outbox.
 *
 * Replies are built from the email that was actually sent rather than from a hand-written
 * token, because the token names one specific question and only the sender knows its id.
 */
function replySubjectFor(index: number): string {
  const email = sentEmails[index];
  if (!email) {
    throw new Error(`No request email was sent at index ${index}; the outbox holds ${sentEmails.length}.`);
  }

  return `Re: ${email.subject}`;
}

beforeEach(() => {
  sentEmails.length = 0;
  parsedReplyBodies.length = 0;
  stagedAnswer = undefined;
  parseFailure = undefined;
  parserAnswersForThisFile = true;
});

afterEach(() => {
  // Outside this file's tests the recorder steps aside; see the note on the mock.
  parserAnswersForThisFile = false;
});

describe('processFormReplies', () => {
  it('reports nothing when there are no emails at all', async () => {
    expect(await processReplies([])).toEqual({
      emailsProcessed: 0,
      formRepliesFound: 0,
      workflowsResumed: 0,
      repliesRejected: 0,
      errors: [],
    });
  });

  it('ignores ordinary mail that carries no run token', async () => {
    const summary = await processReplies([
      inboundReply({ subject: 'Lunch?', from: 'colleague@example.com', content: 'Sushi at noon' }),
    ]);

    expect(summary).toEqual({
      emailsProcessed: 1,
      formRepliesFound: 0,
      workflowsResumed: 0,
      repliesRejected: 0,
      errors: [],
    });
  });

  it('resumes the run named in the subject and finishes it with the parsed reply', async () => {
    const run = await startPendingApproval('boss@example.com');
    stagedAnswer = { approved: true, comments: 'go ahead' };

    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Yes, go ahead' }),
    ]);

    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 1, repliesRejected: 0, errors: [] });
    expect(parsedReplyBodies).toEqual(['Yes, go ahead']);

    const finished = await mastra.getWorkflow('awaitApprovalWorkflow').getWorkflowRunById(run.runId);
    expect(finished?.status).toBe('success');
    expect(finished?.result).toEqual({
      senderEmail: 'boss@example.com',
      response: { approved: true, comments: 'go ahead' },
    });
  });

  it('falls back to the preview when the body did not come back', async () => {
    await startPendingApproval('boss@example.com');
    stagedAnswer = { approved: false };

    await processReplies([
      inboundReply({
        subject: replySubjectFor(0),
        from: 'boss@example.com',
        content: '',
        preview: 'No, too expensive',
      }),
    ]);

    expect(parsedReplyBodies).toEqual(['No, too expensive']);
  });

  it('refuses a reply with nothing in it rather than asking the model to read a blank', async () => {
    const run = await startPendingApproval('boss@example.com');

    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: '   ', preview: '' }),
    ]);

    // `body.content || bodyPreview` is `''` when both are empty, and an empty string used
    // to sail past the `replyBody === undefined` guard straight into the parsing agent.
    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 1, errors: [] });
    expect(parsedReplyBodies).toEqual([]);
    expect((await mastra.getWorkflow('awaitApprovalWorkflow').getWorkflowRunById(run.runId))?.status).toBe('suspended');
  });

  it('drives a multi-stage run on to its next question', async () => {
    const demoRun = await mastra.getWorkflow('humanInTheLoopDemoWorkflow').createRun();
    const started = await demoRun.start({
      inputData: { recipientEmail: 'boss@example.com', projectName: 'Atlas', budgetAmount: 2500 },
    });
    assertStatus(started, 'suspended');
    expect(sentEmails).toHaveLength(1);

    stagedAnswer = { approved: true };
    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Approved' }),
    ]);

    expect(summary).toMatchObject({ workflowsResumed: 1, errors: [] });
    // The reply moved the run on, so the next question is already in the outbox.
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1].subject).toContain('Please select a vendor for project "Atlas".');
  });

  it('refuses a second reply to an answered email instead of feeding it to the next question', async () => {
    const demoRun = await mastra.getWorkflow('humanInTheLoopDemoWorkflow').createRun();
    const started = await demoRun.start({
      inputData: { recipientEmail: 'boss@example.com', projectName: 'Atlas', budgetAmount: 2500 },
    });
    assertStatus(started, 'suspended');
    const budgetReplySubject = replySubjectFor(0);

    stagedAnswer = { approved: true };
    const firstSummary = await processReplies([
      inboundReply({ subject: budgetReplySubject, from: 'boss@example.com', content: 'Yes go ahead' }),
    ]);

    expect(firstSummary).toMatchObject({ workflowsResumed: 1, repliesRejected: 0, errors: [] });
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1].subject).toContain('Please select a vendor for project "Atlas".');

    // The same person replies to the same budget email a second time. Nothing about that
    // email says "vendor", but the run has moved on to the vendor question, and a token
    // carrying only the run id matched it: the parser was handed "Yes go ahead" as a
    // vendor choice and the run mailed out
    // `Final confirmation for project "Atlas" with vendor "Yes go ahead"`.
    stagedAnswer = { vendorName: 'Yes go ahead', justification: 'Yes go ahead' };
    const secondSummary = await processReplies([
      inboundReply({ subject: budgetReplySubject, from: 'boss@example.com', content: 'Yes go ahead' }),
    ]);

    expect(secondSummary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 1, errors: [] });
    // The vendor question never saw the budget reply, and no further email went out.
    expect(parsedReplyBodies).toEqual(['Yes go ahead']);
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails.some((email) => email.subject.includes('vendor "Yes go ahead"'))).toBe(false);

    // The refusal leaves the vendor question open for a real answer.
    const stillPending = await mastra.getWorkflow('humanInTheLoopDemoWorkflow').getWorkflowRunById(demoRun.runId);
    expect(stillPending?.status).toBe('suspended');

    stagedAnswer = { vendorName: 'Acme', justification: 'Cheapest bid' };
    const thirdSummary = await processReplies([
      inboundReply({ subject: replySubjectFor(1), from: 'boss@example.com', content: 'Go with Acme' }),
    ]);

    expect(thirdSummary).toMatchObject({ workflowsResumed: 1, repliesRejected: 0, errors: [] });
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails[2].subject).toContain('Final confirmation for project "Atlas" with vendor "Acme".');
  });

  it('refuses a reply to an earlier question while a later one is waiting', async () => {
    const demoRun = await mastra.getWorkflow('humanInTheLoopDemoWorkflow').createRun();
    assertStatus(
      await demoRun.start({
        inputData: { recipientEmail: 'boss@example.com', projectName: 'Atlas', budgetAmount: 2500 },
      }),
      'suspended',
    );

    stagedAnswer = { approved: true };
    await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Approved' }),
    ]);
    stagedAnswer = { vendorName: 'Acme', justification: 'Cheapest bid' };
    await processReplies([inboundReply({ subject: replySubjectFor(1), from: 'boss@example.com', content: 'Acme' })]);
    expect(sentEmails).toHaveLength(3);

    // Stage three is the question now open; this answers stage two, two hops behind.
    stagedAnswer = { confirmed: true };
    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(1), from: 'boss@example.com', content: 'Actually make it Globex' }),
    ]);

    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 1, errors: [] });
    expect(sentEmails).toHaveLength(3);
    expect((await mastra.getWorkflow('humanInTheLoopDemoWorkflow').getWorkflowRunById(demoRun.runId))?.status).toBe(
      'suspended',
    );
  });

  it('counts a reply from the wrong person as rejected and leaves the run waiting', async () => {
    const run = await startPendingApproval('boss@example.com');
    stagedAnswer = { approved: true };

    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'attacker@example.com', content: 'Yes, approved' }),
    ]);

    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 1, errors: [] });
    // The point of refusing rather than failing: the person who was asked can still answer.
    expect(parsedReplyBodies).toEqual([]);

    const stillPending = await mastra.getWorkflow('awaitApprovalWorkflow').getWorkflowRunById(run.runId);
    expect(stillPending?.status).toBe('suspended');

    const secondSummary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Yes, approved' }),
    ]);

    expect(secondSummary).toMatchObject({ workflowsResumed: 1, repliesRejected: 0 });
  });

  it('counts a reply the parser cannot read as rejected', async () => {
    const run = await startPendingApproval('boss@example.com');
    parseFailure = new Error('The email parsing agent returned no structured response');

    const summary = await processReplies([
      inboundReply({
        subject: replySubjectFor(0),
        from: 'boss@example.com',
        content: 'I will get back to you next week',
      }),
    ]);

    expect(summary).toMatchObject({ workflowsResumed: 0, repliesRejected: 1, errors: [] });
    const stillPending = await mastra.getWorkflow('awaitApprovalWorkflow').getWorkflowRunById(run.runId);
    expect(stillPending?.status).toBe('suspended');
  });

  it('records an error when no run at all answers to the token', async () => {
    const summary = await processReplies([
      inboundReply({
        subject: `Re: ${buildFormRequestSubject({
          runId: 'nobody-is-waiting-for-this',
          requestId: 'req-nobody-asked',
          question: 'Approve the budget?',
        })}`,
        from: 'boss@example.com',
        content: 'Yes',
      }),
    ]);

    // A token naming a run that does not exist is an anomaly worth reporting, unlike a
    // reply that simply arrived too late for the run it names.
    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 0 });
    expect(summary.errors).toEqual(['No workflow run with id nobody-is-waiting-for-this was found']);
  });

  it('refuses a reply to a question the run has already finished answering', async () => {
    const run = await startPendingApproval('boss@example.com');
    stagedAnswer = { approved: true };
    const reply = () => inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Yes' });

    expect(await processReplies([reply()])).toMatchObject({ workflowsResumed: 1, repliesRejected: 0 });
    const summary = await processReplies([reply()]);

    // "No such run" and "that run is not waiting for an email" used to share one message,
    // which hid a reply arriving after its question had already been answered.
    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 1, errors: [] });
    expect(parsedReplyBodies).toEqual(['Yes']);
    expect((await mastra.getWorkflow('awaitApprovalWorkflow').getWorkflowRunById(run.runId))?.status).toBe('success');
  });

  it('reports why a resume failed, reading the message out of the error Mastra serialised', async () => {
    const run = await mastra.getWorkflow('failsAfterReplyWorkflow').createRun();
    assertStatus(
      await run.start({ inputData: { recipientEmail: 'boss@example.com', question: 'Approve?' } }),
      'suspended',
    );
    stagedAnswer = { approved: true };

    const summary = await processReplies([
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Yes' }),
    ]);

    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 0, repliesRejected: 0 });
    expect(summary.errors).toEqual([
      `Error processing email "${replySubjectFor(0)}": Resuming failsAfterReplyWorkflow run ${run.runId} failed: ${RESUME_FAILURE_MESSAGE}`,
    ]);
  });

  it('leaves a run suspended on something other than an email question alone', async () => {
    const otherRun = await mastra.getWorkflow('awaitSomethingElseWorkflow').createRun();
    const started = await otherRun.start({ inputData: {} });
    assertStatus(started, 'suspended');

    const summary = await processReplies([
      inboundReply({
        subject: `Re: ${buildFormRequestSubject({
          runId: otherRun.runId,
          requestId: 'req-not-an-email-question',
          question: 'Approve the budget?',
        })}`,
        from: 'boss@example.com',
        content: 'Yes',
      }),
    ]);

    expect(summary).toMatchObject({ workflowsResumed: 0, repliesRejected: 1, errors: [] });
    expect((await mastra.getWorkflow('awaitSomethingElseWorkflow').getWorkflowRunById(otherRun.runId))?.status).toBe(
      'suspended',
    );
  });

  it('keeps going after one reply cannot be matched', async () => {
    await startPendingApproval('boss@example.com');
    stagedAnswer = { approved: true };

    const summary = await processReplies([
      inboundReply({
        subject: `Re: ${buildFormRequestSubject({ runId: 'gone', requestId: 'req-gone', question: 'Approve?' })}`,
        from: 'boss@example.com',
        content: 'Yes',
      }),
      inboundReply({ subject: replySubjectFor(0), from: 'boss@example.com', content: 'Yes' }),
    ]);

    expect(summary).toMatchObject({ emailsProcessed: 2, formRepliesFound: 2, workflowsResumed: 1 });
    expect(summary.errors).toHaveLength(1);
  });
});

describe('a run waiting on two questions at once', () => {
  /** Starts the parallel workflow and returns the two request emails it sent. */
  async function askTwoQuestions() {
    const run = await mastra.getWorkflow('askTwoAtOnceWorkflow').createRun();
    const started = await run.start({
      inputData: { recipientEmail: 'boss@example.com', question: 'Approve?' },
    });

    assertStatus(started, 'suspended');
    expect(sentEmails).toHaveLength(2);

    return sentEmails.map((email) => email.subject);
  }

  it('answers the question the reply was sent for, not whichever suspended first', async () => {
    const [firstSubject, secondSubject] = await askTwoQuestions();

    // Two suspensions, two distinct request ids.
    expect(parseFormRequestSubject(firstSubject)?.requestId).not.toBe(
      parseFormRequestSubject(secondSubject)?.requestId,
    );

    stagedAnswer = { approved: true };
    const summary = await processReplies([
      inboundReply({ subject: `Re: ${secondSubject}`, from: 'boss@example.com', content: 'Yes' }),
    ]);

    // Before the reply handler matched on the request id, this reply was offered to the
    // first suspended step, which refused it -- so the run advanced not at all and the
    // second question was unanswerable by email for as long as the first stayed open.
    expect(summary).toMatchObject({ formRepliesFound: 1, workflowsResumed: 1, repliesRejected: 0, errors: [] });
    expect(parsedReplyBodies).toEqual(['Yes']);
  });

  it('still lets the other question be answered afterwards', async () => {
    const [firstSubject, secondSubject] = await askTwoQuestions();

    stagedAnswer = { approved: true };
    await processReplies([
      inboundReply({ subject: `Re: ${secondSubject}`, from: 'boss@example.com', content: 'Yes to the second' }),
    ]);

    const summary = await processReplies([
      inboundReply({ subject: `Re: ${firstSubject}`, from: 'boss@example.com', content: 'Yes to the first' }),
    ]);

    // Answering one must not strand the other: both were asked, both can be answered.
    expect(summary).toMatchObject({ workflowsResumed: 1, repliesRejected: 0, errors: [] });
    expect(parsedReplyBodies).toEqual(['Yes to the second', 'Yes to the first']);
  });
});
