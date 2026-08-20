import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { createWorkflow } from '../../utils/workflows/workflow-factory.js';
import * as realEmailTools from '../email/tools.js';
import * as realAgents from './agents.js';

/**
 * The workflow sends real mail through the Microsoft Graph API, so `sendEmail`
 * is replaced with a recorder. The rest of the email vertical is spread back in
 * because `mock.module` is process-global in Bun: other spec files sharing this
 * process (e.g. email/tools.spec.ts, which uses `findEmails`) must still see the
 * real exports.
 */
interface SentEmail {
  subject: string;
  bodyContent: string;
  toRecipients: string[];
}

const sentEmails: SentEmail[] = [];
let sendEmailFailure: Error | undefined;

mock.module('../email/tools.js', () => ({
  ...realEmailTools,
  // `executeTool` only reaches for `id` and `execute`; the schemas are carried over so
  // the replacement stays a faithful stand-in for anything else that inspects the tool.
  sendEmail: {
    id: 'sendEmail',
    inputSchema: realEmailTools.sendEmail.inputSchema,
    outputSchema: realEmailTools.sendEmail.outputSchema,
    execute: async (inputData: SentEmail) => {
      sentEmails.push(inputData);
      if (sendEmailFailure) {
        throw sendEmailFailure;
      }
      return {
        // What the real tool returns: Graph's sendMail answers 202 with no body, so there
        // is no message id to report.
        messageId: 'sent',
        subject: inputData.subject,
        success: true,
        message: 'Email sent successfully',
      };
    },
  },
}));

/**
 * Reading a reply is a model call, so the parsing agent is replaced by a recorder that
 * returns whatever the test has staged. It still validates through the caller's response
 * schema, so a test cannot stage an answer the real parser could not have produced.
 *
 * `mock.module` is process-global, so this stand-in is what every caller in the process
 * sees -- including `agents.spec.ts`, which tests the real `parseEmailReply` with only the
 * model underneath it replaced. It therefore answers only while a test in *this* file is
 * running, and hands the call to the real function outside that window. The real function
 * is captured before the mock is registered, because registering it rewrites the module
 * namespace in place.
 */
interface ParseRequest {
  question: string;
  replyBody: string;
}

const parseRequests: ParseRequest[] = [];
let stagedAnswer: unknown;
let parseFailure: Error | undefined;
let parserAnswersForThisFile = false;
const realParseEmailReply = realAgents.parseEmailReply;

mock.module('./agents.js', () => ({
  ...realAgents,
  parseEmailReply: async <TResponseSchema extends z.ZodObject<z.ZodRawShape>>(request: {
    question: string;
    replyBody: string;
    responseSchema: TResponseSchema;
  }) => {
    if (!parserAnswersForThisFile) {
      return await realParseEmailReply(request);
    }

    const { question, replyBody, responseSchema } = request;
    parseRequests.push({ question, replyBody });
    if (parseFailure) {
      throw parseFailure;
    }
    return responseSchema.parse(stagedAnswer);
  },
}));

const {
  buildFormRequestSubject,
  getSendEmailAndAwaitResponseWorkflow,
  humanInTheLoopDemoWorkflow,
  parseFormRequestSubject,
} = await import('./workflows.js');

/** Narrows a workflow result so the status-specific fields are reachable. */
function assertStatus<TResult extends { status: string }, TStatus extends TResult['status']>(
  result: TResult,
  status: TStatus,
): asserts result is Extract<TResult, { status: TStatus }> {
  expect(result.status).toBe(status);
}

const budgetApprovalResponseSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
});

const awaitBudgetApprovalWorkflow = getSendEmailAndAwaitResponseWorkflow(
  'budgetApprovalUnderTest',
  budgetApprovalResponseSchema,
);

const sendAndWaitMastra = new Mastra({ workflows: { awaitBudgetApprovalWorkflow } });

async function startFormRequest(inputData: { recipientEmail: string; question: string }) {
  const run = await sendAndWaitMastra.getWorkflow('awaitBudgetApprovalWorkflow').createRun();
  const started = await run.start({ inputData });
  return { run, started };
}

/**
 * The request id carried by the email at `index` in the outbox.
 *
 * A reply is only accepted for the request it quotes, so every resume in these tests takes
 * the same route a real reply does: read the token back off the email that was sent.
 */
function requestIdOf(index: number): string {
  const email = sentEmails[index];
  if (!email) {
    throw new Error(`No email was sent at index ${index}; the outbox holds ${sentEmails.length}.`);
  }

  const formRequest = parseFormRequestSubject(email.subject);
  if (!formRequest) {
    throw new Error(`The subject "${email.subject}" carries no form request token.`);
  }

  return formRequest.requestId;
}

beforeEach(() => {
  sentEmails.length = 0;
  parseRequests.length = 0;
  sendEmailFailure = undefined;
  parseFailure = undefined;
  stagedAnswer = undefined;
  parserAnswersForThisFile = true;
});

afterEach(() => {
  // Outside this file's tests the recorder steps aside; see the note on the mock.
  parserAnswersForThisFile = false;
});

describe('getSendEmailAndAwaitResponseWorkflow', () => {
  it('names the workflow after the slug it was built with', () => {
    expect(awaitBudgetApprovalWorkflow.id).toBe('sendEmailAndAwaitResponseWorkflow-budgetApprovalUnderTest');
  });

  it('consists of exactly the send step and the suspending step', () => {
    // Still no timeout/expiry step: a suspended request waits until it is answered. The
    // email no longer claims otherwise.
    expect(Object.keys(awaitBudgetApprovalWorkflow.steps)).toEqual(['send-form-request-email', 'await-email-response']);
  });

  describe('sending the form request', () => {
    it('sends a single email to the recipient with the run id in the subject', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].toRecipients).toEqual(['boss@example.com']);
      // The run id, not the workflow id: the workflow id is the same for every run and
      // every recipient, so it could never say which suspended run a reply answers. The
      // request id alongside it says which question of that run was asked.
      expect(sentEmails[0].subject).toBe(
        buildFormRequestSubject({ runId: run.runId, requestId: requestIdOf(0), question: 'Approve the budget?' }),
      );
      expect(parseFormRequestSubject(sentEmails[0].subject)).toEqual({
        runId: run.runId,
        requestId: requestIdOf(0),
      });
    });

    it('reads its own token back out of a subject a mail client has replied to', () => {
      const subject = buildFormRequestSubject({ runId: 'run-1', requestId: 'req-1', question: 'Approve?' });

      // The one definition of the token's shape is shared by both sides, so the sweeper
      // cannot drift away from the format the email actually carries.
      expect(parseFormRequestSubject(`Re: ${subject}`)).toEqual({ runId: 'run-1', requestId: 'req-1' });
      expect(parseFormRequestSubject('Re: Lunch?')).toBeUndefined();
      expect(parseFormRequestSubject('Re: Form Request [RUN-run-1]: Approve?')).toBeUndefined();
    });

    it('gives two runs of the same workflow different subject tokens', async () => {
      const first = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });
      const second = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      expect(first.run.runId).not.toBe(second.run.runId);
      expect(sentEmails[0].subject).not.toBe(sentEmails[1].subject);
    });

    it('builds an HTML body carrying the question, the run id and the reply instructions', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });

      const { bodyContent } = sentEmails[0];
      expect(bodyContent.startsWith('<html>')).toBe(true);
      expect(bodyContent.endsWith('</html>')).toBe(true);
      expect(bodyContent).toContain('<strong>Question:</strong> Approve the budget?');
      expect(bodyContent).toContain(`Request reference: ${run.runId}/${requestIdOf(0)}`);
      expect(bodyContent).toContain('Please do not modify the subject line');
    });

    it('promises no expiry, because nothing expires the request', async () => {
      await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });

      // The body used to render a date 14 days out and call it an expiry, while the graph
      // was only send -> await: no step, sweeper or timer ever ended a suspension.
      expect(sentEmails[0].bodyContent.toLowerCase()).not.toContain('expire');
    });

    it('rejects a recipient that is not an email address', async () => {
      const run = await sendAndWaitMastra.getWorkflow('awaitBudgetApprovalWorkflow').createRun();

      await expect(run.start({ inputData: { recipientEmail: 'boss', question: 'Approve?' } })).rejects.toThrow(
        /recipientEmail: Invalid email address/,
      );
      expect(sentEmails).toHaveLength(0);
    });

    it('fails the run without suspending when the email cannot be sent', async () => {
      sendEmailFailure = new Error('Failed to send email: 401 Unauthorized');

      const { started } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      assertStatus(started, 'failed');
      expect(started.error.message).toContain('Failed to send email');
    });
  });

  describe('suspending', () => {
    it('describes the pending request in the suspend payload', async () => {
      const { started } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      assertStatus(started, 'suspended');
      expect(started.suspended).toEqual([['await-email-response']]);
      expect(started.steps['await-email-response'].status).toBe('suspended');
      // The payload used to be `{}`, which told a resumer nothing about who was asked,
      // what was asked, or which shape the answer must have.
      expect(started.suspendPayload).toEqual({
        'await-email-response': {
          recipientEmail: 'boss@example.com',
          question: 'Approve?',
          // The id a reply has to quote, rather than the message id: Graph reports no
          // message id for a sent mail, so that field could only ever say 'sent'.
          requestId: requestIdOf(0),
          responseSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { approved: { type: 'boolean' }, comments: { type: 'string' } },
            required: ['approved'],
            additionalProperties: false,
          },
        },
      });
    });
  });

  describe('resuming', () => {
    it('returns the sender and the typed response when the reply comes from the recipient', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: {
          requestId: requestIdOf(0),
          senderEmail: 'boss@example.com',
          response: { approved: true, comments: 'Looks good' },
        },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result).toEqual({
        senderEmail: 'boss@example.com',
        response: { approved: true, comments: 'Looks good' },
      });
      // A caller that already has a structured answer does not pay for a model call.
      expect(parseRequests).toHaveLength(0);
    });

    it('reads a free-text reply through the email parsing agent', async () => {
      stagedAnswer = { approved: true, comments: 'go for it' };
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', replyBody: 'Yeah fine, go for it' },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ approved: true, comments: 'go for it' });
      // The parser is given the question as context, not just the loose text.
      expect(parseRequests).toEqual([{ question: 'Approve?', replyBody: 'Yeah fine, go for it' }]);
    });

    it('compares the sender against the recipient case-insensitively', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'Boss@Example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@EXAMPLE.com', response: { approved: false } },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.senderEmail).toBe('boss@EXAMPLE.com');
    });

    it('drops fields the response schema does not declare', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: {
          requestId: requestIdOf(0),
          senderEmail: 'boss@example.com',
          response: { approved: true, injected: 'ignore me' },
        },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ approved: true });
    });

    it('refuses a reply from somebody else without accepting it', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'attacker@example.com', response: { approved: true } },
      });

      assertStatus(resumed, 'suspended');
      expect(resumed.suspendPayload['await-email-response'].rejectedReply).toEqual({
        senderEmail: 'attacker@example.com',
        reason: 'the reply came from attacker@example.com, and the request was sent to boss@example.com',
      });
    });

    it('keeps the pending request alive when a reply from the wrong sender arrives first', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });
      await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'attacker@example.com', response: { approved: true } },
      });

      // The security check used to throw, which killed the run: one forwarded or aliased
      // reply permanently destroyed an approval nobody had answered yet.
      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: true } },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.senderEmail).toBe('boss@example.com');
    });

    it('refuses an empty sender rather than skipping the security check', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: '', response: { approved: true } },
      });

      // The guard used to read `if (senderEmail && ...)`, so a falsy sender skipped
      // validation and the approval was accepted from nobody. An absent address is not
      // evidence that the right person replied.
      assertStatus(resumed, 'suspended');
      expect(resumed.suspendPayload['await-email-response'].rejectedReply).toEqual({
        senderEmail: '',
        reason: 'the reply carried no sender address, and the request was sent to boss@example.com',
      });
    });

    it('refuses a reply that answers a request other than the one still open', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const refused = await run.resume({
        step: ['await-email-response'],
        resumeData: {
          requestId: 'a-request-this-run-never-asked',
          senderEmail: 'boss@example.com',
          response: { approved: true },
        },
      });

      // Without this check the run id alone decided which question a reply answered, so a
      // duplicate or late reply was applied to whichever question happened to be open.
      assertStatus(refused, 'suspended');
      expect(refused.suspendPayload['await-email-response'].rejectedReply).toEqual({
        senderEmail: 'boss@example.com',
        reason: `the reply answers request a-request-this-run-never-asked, and the question still open is request ${requestIdOf(0)}`,
      });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: true } },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ approved: true });
    });

    it('refuses a reply whose body is blank rather than asking the model to read it', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', replyBody: '   \n  ' },
      });

      // The guard used to be `replyBody === undefined`, so an empty body reached the
      // parsing agent, which was then free to invent a decision from nothing.
      assertStatus(resumed, 'suspended');
      expect(resumed.suspendPayload['await-email-response'].rejectedReply?.reason).toBe(
        'the resume carried neither a structured response nor a reply body to parse',
      );
      expect(parseRequests).toEqual([]);
    });

    it('refuses a reply the parsing agent cannot read as an answer', async () => {
      parseFailure = new Error('The email parsing agent returned no structured response');
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const refused = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', replyBody: 'let me think about it' },
      });

      // An answer nobody gave must not become an answer, and must not cost the request:
      // the same person can still reply properly afterwards.
      assertStatus(refused, 'suspended');
      expect(refused.suspendPayload['await-email-response'].rejectedReply?.reason).toContain(
        'the reply could not be read as an answer',
      );

      parseFailure = undefined;
      stagedAnswer = { approved: true };
      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', replyBody: 'Yes, approved' },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ approved: true });
    });

    it('refuses a resume that carries neither a structured response nor a reply body', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com' },
      });

      assertStatus(resumed, 'suspended');
      expect(resumed.suspendPayload['await-email-response'].rejectedReply?.reason).toBe(
        'the resume carried neither a structured response nor a reply body to parse',
      );
    });

    it('rejects a response that does not match the schema', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      await expect(
        run.resume({
          step: ['await-email-response'],
          resumeData: {
            requestId: requestIdOf(0),
            senderEmail: 'boss@example.com',
            response: { approved: 'yes please' },
          },
        }),
      ).rejects.toThrow(/response.approved: Invalid input: expected boolean, received string/);

      // Rejected before the step ran, so the request is untouched and still answerable.
      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: true } },
      });
      assertStatus(resumed, 'success');
    });

    it('rejects a resume that carries no data at all', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      await expect(run.resume({ step: ['await-email-response'] })).rejects.toThrow(/Invalid resume data/);
    });
  });

  describe('per-slug response schemas', () => {
    const vendorSelectionResponseSchema = z.object({
      vendorName: z.string(),
      justification: z.string(),
    });
    const awaitVendorSelectionWorkflow = getSendEmailAndAwaitResponseWorkflow(
      'vendorSelectionUnderTest',
      vendorSelectionResponseSchema,
    );
    const vendorMastra = new Mastra({ workflows: { awaitVendorSelectionWorkflow } });

    it('validates the reply against the schema the workflow was built with', async () => {
      const run = await vendorMastra.getWorkflow('awaitVendorSelectionWorkflow').createRun();
      await run.start({ inputData: { recipientEmail: 'boss@example.com', question: 'Which vendor?' } });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: {
          requestId: requestIdOf(0),
          senderEmail: 'boss@example.com',
          response: { vendorName: 'Acme', justification: 'Cheapest bid' },
        },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ vendorName: 'Acme', justification: 'Cheapest bid' });
    });

    it('advertises its own response shape in the suspend payload', async () => {
      const run = await vendorMastra.getWorkflow('awaitVendorSelectionWorkflow').createRun();
      const started = await run.start({ inputData: { recipientEmail: 'boss@example.com', question: 'Which vendor?' } });

      assertStatus(started, 'suspended');
      expect(started.suspendPayload['await-email-response'].responseSchema).toMatchObject({
        properties: { vendorName: { type: 'string' }, justification: { type: 'string' } },
        required: ['vendorName', 'justification'],
      });
    });

    it('refuses a reply shaped for a different slug', async () => {
      const run = await vendorMastra.getWorkflow('awaitVendorSelectionWorkflow').createRun();
      await run.start({ inputData: { recipientEmail: 'boss@example.com', question: 'Which vendor?' } });

      await expect(
        run.resume({
          step: ['await-email-response'],
          resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: true } },
        }),
      ).rejects.toThrow(/vendorName/);
    });
  });
});

describe('humanInTheLoopDemoWorkflow', () => {
  const demoMastra = new Mastra({ workflows: { humanInTheLoopDemoWorkflow } });

  const budgetApprovalStep = ['sendEmailAndAwaitResponseWorkflow-budgetApproval', 'await-email-response'];
  const vendorSelectionStep = ['sendEmailAndAwaitResponseWorkflow-vendorSelection', 'await-email-response'];
  const finalConfirmationStep = ['sendEmailAndAwaitResponseWorkflow-finalConfirmation', 'await-email-response'];

  /**
   * Mastra types `run.start()` with the *output* of the input schema, so a field carrying
   * a default still has to be passed. `listWorkflows()` hands back the same instances
   * under the loosely typed `Workflow` signature, which is how these tests give the
   * workflow the partial input a caller really would -- defaults included.
   */
  const looselyTypedDemoWorkflow = demoMastra.listWorkflows().humanInTheLoopDemoWorkflow;

  async function startDemoRun(inputData: { recipientEmail: string; projectName?: string; budgetAmount?: number }) {
    const run = await looselyTypedDemoWorkflow.createRun();
    const started = await run.start({ inputData });
    return { run, started };
  }

  it('refuses to run without a recipient instead of mailing a placeholder', async () => {
    const run = await looselyTypedDemoWorkflow.createRun();

    // `recipientEmail` used to default to demo@example.com, so pressing "run" on this
    // workflow in Mastra Studio sent real mail to whoever owned that address.
    await expect(run.start({ inputData: { projectName: 'Atlas' } })).rejects.toThrow(/recipientEmail/);
    expect(sentEmails).toHaveLength(0);
  });

  it('still falls back to the demo project and budget', async () => {
    const { started } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    assertStatus(started, 'suspended');
    expect(started.input).toEqual({
      recipientEmail: 'boss@example.com',
      projectName: 'Demo Project',
      budgetAmount: 10000,
    });
    expect(sentEmails[0].toRecipients).toEqual(['boss@example.com']);
    expect(sentEmails[0].subject).toContain('Please approve the budget for project "Demo Project". Amount: $10,000.');
  });

  it('renders the budget with thousands separators in the question', async () => {
    await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas', budgetAmount: 1234567 });

    expect(sentEmails[0].subject).toContain('Please approve the budget for project "Atlas". Amount: $1,234,567.');
  });

  it('suspends inside the nested budget approval workflow first', async () => {
    const { started } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    assertStatus(started, 'suspended');
    expect(started.suspended).toEqual([budgetApprovalStep]);
    expect(sentEmails).toHaveLength(1);
  });

  it('gives every stage of one run its own request id under the shared run id', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas' });

    await run.resume({
      step: budgetApprovalStep,
      resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: true } },
    });

    // Every stage suspends under the same run id, which is exactly why the run id alone
    // cannot say which question a reply answers.
    const budget = parseFormRequestSubject(sentEmails[0].subject);
    const vendor = parseFormRequestSubject(sentEmails[1].subject);
    expect(budget?.runId).toBe(run.runId);
    expect(vendor?.runId).toBe(run.runId);
    expect(budget?.requestId).not.toBe(vendor?.requestId);
  });

  it('walks approval, then vendor selection, then final confirmation, and finishes', async () => {
    const { run } = await startDemoRun({
      recipientEmail: 'boss@example.com',
      projectName: 'Atlas',
      budgetAmount: 2500,
    });

    const afterApproval = await run.resume({
      step: budgetApprovalStep,
      resumeData: {
        requestId: requestIdOf(0),
        senderEmail: 'boss@example.com',
        response: { approved: true, comments: 'Go ahead' },
      },
    });

    assertStatus(afterApproval, 'suspended');
    expect(afterApproval.suspended).toEqual([vendorSelectionStep]);
    expect(sentEmails).toHaveLength(2);
    // The project name survives the nested workflow because the merge step reads it
    // back from the workflow's init data.
    expect(sentEmails[1].subject).toContain('Please select a vendor for project "Atlas".');

    const afterVendorSelection = await run.resume({
      step: vendorSelectionStep,
      resumeData: {
        requestId: requestIdOf(1),
        senderEmail: 'boss@example.com',
        response: { vendorName: 'Acme', justification: 'Cheapest bid' },
      },
    });

    assertStatus(afterVendorSelection, 'suspended');
    expect(afterVendorSelection.suspended).toEqual([finalConfirmationStep]);
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails[2].subject).toContain('Final confirmation for project "Atlas" with vendor "Acme".');

    const afterConfirmation = await run.resume({
      step: finalConfirmationStep,
      resumeData: {
        requestId: requestIdOf(2),
        senderEmail: 'boss@example.com',
        response: { confirmed: true, finalNotes: 'Ship it' },
      },
    });

    // The last hop used to die: the nested workflow emits only `{ senderEmail, response }`
    // and nothing put the chosen vendor back on the context, so the demo could never
    // reach its own final output.
    assertStatus(afterConfirmation, 'success');
    expect(afterConfirmation.result).toEqual({
      success: true,
      message: 'Workflow completed successfully! Budget approved, vendor "Acme" selected and confirmed.',
      approvalGranted: true,
      vendorSelected: 'Acme',
      finalConfirmation: true,
    });
  });

  it('runs end to end on free-text replies alone', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas' });

    stagedAnswer = { approved: true };
    await run.resume({
      step: budgetApprovalStep,
      resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', replyBody: 'Yes, that budget is fine' },
    });

    stagedAnswer = { vendorName: 'Acme', justification: 'Cheapest bid' };
    await run.resume({
      step: vendorSelectionStep,
      resumeData: {
        requestId: requestIdOf(1),
        senderEmail: 'boss@example.com',
        replyBody: 'Go with Acme, they were cheapest',
      },
    });

    stagedAnswer = { confirmed: false, finalNotes: 'Changed my mind' };
    const finished = await run.resume({
      step: finalConfirmationStep,
      resumeData: { requestId: requestIdOf(2), senderEmail: 'boss@example.com', replyBody: 'Actually cancel it' },
    });

    assertStatus(finished, 'success');
    expect(finished.result).toEqual({
      success: true,
      message: 'Workflow completed. Vendor "Acme" was selected but final confirmation was cancelled.',
      approvalGranted: true,
      vendorSelected: 'Acme',
      finalConfirmation: false,
    });
    expect(parseRequests.map((request) => request.replyBody)).toEqual([
      'Yes, that budget is fine',
      'Go with Acme, they were cheapest',
      'Actually cancel it',
    ]);
  });

  it('sends the follow-up requests to the address that actually replied', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    await run.resume({
      step: budgetApprovalStep,
      // Accepted by the case-insensitive check, and from here on it becomes the recipient.
      resumeData: { requestId: requestIdOf(0), senderEmail: 'BOSS@Example.com', response: { approved: true } },
    });

    expect(sentEmails[1].toRecipients).toEqual(['BOSS@Example.com']);
  });

  it('completes with a rejection when the budget is not approved', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas' });

    const afterRejection = await run.resume({
      step: budgetApprovalStep,
      resumeData: {
        requestId: requestIdOf(0),
        senderEmail: 'boss@example.com',
        response: { approved: false, comments: 'Too expensive' },
      },
    });

    // "No" is one of the two answers the question invites, and the output schema models
    // it. The run used to fail with "Budget was not approved - workflow cannot continue".
    assertStatus(afterRejection, 'success');
    expect(afterRejection.result).toEqual({
      success: true,
      message: 'Workflow completed. The budget for project "Atlas" was not approved: Too expensive',
      approvalGranted: false,
    });
    expect(sentEmails).toHaveLength(1);
  });

  it('reports a rejection without comments too', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas' });

    const afterRejection = await run.resume({
      step: budgetApprovalStep,
      resumeData: { requestId: requestIdOf(0), senderEmail: 'boss@example.com', response: { approved: false } },
    });

    assertStatus(afterRejection, 'success');
    expect(afterRejection.result).toEqual({
      success: true,
      message: 'Workflow completed. The budget for project "Atlas" was not approved.',
      approvalGranted: false,
    });
  });

  it('stops an empty sender at the security check and keeps waiting', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    const afterApproval = await run.resume({
      step: budgetApprovalStep,
      resumeData: { requestId: requestIdOf(0), senderEmail: '', response: { approved: true } },
    });

    // Previously the approval was accepted and the run limped on, only dying once the
    // empty address was reused as the next recipient -- reported as
    // "recipientEmail: Invalid email address", which says nothing about the real problem.
    assertStatus(afterApproval, 'suspended');
    expect(afterApproval.suspended).toEqual([budgetApprovalStep]);
    expect(sentEmails).toHaveLength(1);
  });
});

describe('demo workflow steps in isolation', () => {
  /**
   * Steps are private to the module, but the committed workflow exposes them, so a step
   * is driven directly through a one-step harness when the interesting input is easier to
   * hand it than to reach through the graph.
   */
  async function runStepInIsolation<TInputSchema extends z.ZodTypeAny, TOutputSchema extends z.ZodTypeAny>(
    stepId: string,
    schemas: { inputSchema: TInputSchema; outputSchema: TOutputSchema },
    inputData: z.input<TInputSchema>,
  ): Promise<z.infer<TOutputSchema>> {
    const harness = createWorkflow({
      id: `isolated-${stepId}`,
      inputSchema: schemas.inputSchema,
      outputSchema: schemas.outputSchema,
    })
      .then(humanInTheLoopDemoWorkflow.steps[stepId])
      .commit();

    const mastra = new Mastra({ workflows: { harness } });
    const run = await mastra.listWorkflows().harness.createRun();
    const result = await run.start({ inputData });

    assertStatus(result, 'success');
    return schemas.outputSchema.parse(result.result);
  }

  const finalConfirmationInputSchema = z.object({
    confirmed: z.boolean(),
    finalNotes: z.string().optional(),
    vendorName: z.string(),
  });

  const finalOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    approvalGranted: z.boolean().optional(),
    vendorSelected: z.string().optional(),
    finalConfirmation: z.boolean().optional(),
  });

  const budgetApprovalContextSchema = z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
    projectName: z.string(),
  });

  it('reports a fully confirmed run as successful', async () => {
    const output = await runStepInIsolation(
      'format-final-output',
      { inputSchema: finalConfirmationInputSchema, outputSchema: finalOutputSchema },
      { confirmed: true, finalNotes: 'Ship it', vendorName: 'Acme' },
    );

    expect(output).toEqual({
      success: true,
      message: 'Workflow completed successfully! Budget approved, vendor "Acme" selected and confirmed.',
      approvalGranted: true,
      vendorSelected: 'Acme',
      finalConfirmation: true,
    });
  });

  it('reports a cancelled confirmation as a successful run with finalConfirmation false', async () => {
    const output = await runStepInIsolation(
      'format-final-output',
      { inputSchema: finalConfirmationInputSchema, outputSchema: finalOutputSchema },
      { confirmed: false, vendorName: 'Acme' },
    );

    expect(output).toEqual({
      success: true,
      message: 'Workflow completed. Vendor "Acme" was selected but final confirmation was cancelled.',
      approvalGranted: true,
      vendorSelected: 'Acme',
      finalConfirmation: false,
    });
  });

  it('extracts the final confirmation once the vendor name is supplied', async () => {
    const output = await runStepInIsolation(
      'extract-final-confirmation-response',
      {
        inputSchema: z.object({
          senderEmail: z.string(),
          response: z.object({ confirmed: z.boolean(), finalNotes: z.string().optional() }),
          vendorName: z.string(),
        }),
        outputSchema: finalConfirmationInputSchema,
      },
      {
        senderEmail: 'boss@example.com',
        response: { confirmed: true, finalNotes: 'Ship it' },
        vendorName: 'Acme',
      },
    );

    expect(output).toEqual({ confirmed: true, finalNotes: 'Ship it', vendorName: 'Acme' });
  });

  it('reuses the replying address as the recipient for the next request', async () => {
    const output = await runStepInIsolation(
      'extract-budget-approval-response',
      {
        inputSchema: z.object({
          senderEmail: z.string(),
          response: z.object({ approved: z.boolean(), comments: z.string().optional() }),
        }),
        outputSchema: z.object({
          approved: z.boolean(),
          comments: z.string().optional(),
          recipientEmail: z.string(),
        }),
      },
      { senderEmail: 'boss@example.com', response: { approved: true, comments: 'Fine' } },
    );

    expect(output).toEqual({ approved: true, comments: 'Fine', recipientEmail: 'boss@example.com' });
  });

  it('passes an approved budget straight through the rejection gate', async () => {
    const output = await runStepInIsolation(
      'stop-when-budget-is-rejected',
      { inputSchema: budgetApprovalContextSchema, outputSchema: budgetApprovalContextSchema },
      { approved: true, comments: 'Fine', recipientEmail: 'boss@example.com', projectName: 'Atlas' },
    );

    expect(output).toEqual({
      approved: true,
      comments: 'Fine',
      recipientEmail: 'boss@example.com',
      projectName: 'Atlas',
    });
  });
});

describe('human-in-the-loop vertical exports', () => {
  it('re-exports the agent, the tools and both workflows', async () => {
    const vertical = await import('./index.js');

    expect(typeof vertical.getEmailParsingAgent).toBe('function');
    expect(typeof vertical.getSendEmailAndAwaitResponseWorkflow).toBe('function');
    expect(vertical.humanInTheLoopDemoWorkflow.id).toBe('humanInTheLoopDemoWorkflow');
    // The vertical ships no tools yet; the export exists so the registry can spread it.
    expect(vertical.humanInTheLoopTools).toEqual({});
  });
});
