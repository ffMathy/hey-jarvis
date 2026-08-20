import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { createWorkflow } from '../../utils/workflows/workflow-factory.js';
import * as realEmailTools from '../email/tools.js';

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
        messageId: 'mock-message-id',
        subject: inputData.subject,
        success: true,
        message: 'Email sent successfully',
      };
    },
  },
}));

const { getSendEmailAndAwaitResponseWorkflow, humanInTheLoopDemoWorkflow } = await import('./workflows.js');

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

beforeEach(() => {
  sentEmails.length = 0;
  sendEmailFailure = undefined;
});

describe('getSendEmailAndAwaitResponseWorkflow', () => {
  it('names the workflow after the slug it was built with', () => {
    expect(awaitBudgetApprovalWorkflow.id).toBe('sendEmailAndAwaitResponseWorkflow-budgetApprovalUnderTest');
  });

  it('consists of exactly the send step and the suspending step', () => {
    // No timeout/expiry step exists: the 14 days advertised in the email body are
    // never enforced by the graph.
    expect(Object.keys(awaitBudgetApprovalWorkflow.steps)).toEqual(['send-form-request-email', 'await-email-response']);
  });

  describe('sending the form request', () => {
    it('sends a single email to the recipient with the workflow id in the subject', async () => {
      await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].toRecipients).toEqual(['boss@example.com']);
      expect(sentEmails[0].subject).toBe(
        'Form Request [WF-sendEmailAndAwaitResponseWorkflow-budgetApprovalUnderTest]: Approve the budget?',
      );
    });

    it('builds an HTML body carrying the question, the workflow id and the reply instructions', async () => {
      await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });

      const { bodyContent } = sentEmails[0];
      expect(bodyContent.startsWith('<html>')).toBe(true);
      expect(bodyContent.endsWith('</html>')).toBe(true);
      expect(bodyContent).toContain('<strong>Question:</strong> Approve the budget?');
      expect(bodyContent).toContain('Workflow ID: sendEmailAndAwaitResponseWorkflow-budgetApprovalUnderTest');
      expect(bodyContent).toContain('Please do not modify the subject line');
    });

    it('advertises an expiry date 14 days out', async () => {
      const beforeSending = new Date();
      await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve the budget?' });
      const afterSending = new Date();

      // The body renders a full `toLocaleString()`; only the date part is compared so
      // the assertion does not race the clock. Both candidates cover a midnight crossing.
      const expiryDates = [beforeSending, afterSending].map((moment) => {
        const expiry = new Date(moment);
        expiry.setDate(expiry.getDate() + 14);
        return expiry.toLocaleDateString();
      });

      expect(expiryDates.some((expiryDate) => sentEmails[0].bodyContent.includes(expiryDate))).toBe(true);
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
    it('suspends on the await step with an empty payload', async () => {
      const { started } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      assertStatus(started, 'suspended');
      expect(started.suspended).toEqual([['await-email-response']]);
      // The suspend payload is empty, so whoever resumes the run learns nothing about
      // who was asked, what was asked, or which shape the answer must have.
      expect(started.steps['await-email-response'].status).toBe('suspended');
      expect(started.suspendPayload).toEqual({ 'await-email-response': {} });
    });
  });

  describe('resuming', () => {
    it('returns the sender and the typed response when the reply comes from the recipient', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { senderEmail: 'boss@example.com', response: { approved: true, comments: 'Looks good' } },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result).toEqual({
        senderEmail: 'boss@example.com',
        response: { approved: true, comments: 'Looks good' },
      });
    });

    it('compares the sender against the recipient case-insensitively', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'Boss@Example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { senderEmail: 'boss@EXAMPLE.com', response: { approved: false } },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.senderEmail).toBe('boss@EXAMPLE.com');
    });

    it('drops fields the response schema does not declare', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: {
          senderEmail: 'boss@example.com',
          response: { approved: true, injected: 'ignore me' },
        },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ approved: true });
    });

    it('fails the run when the reply comes from somebody else', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { senderEmail: 'attacker@example.com', response: { approved: true } },
      });

      assertStatus(resumed, 'failed');
      expect(resumed.error.message).toBe(
        'Security validation failed: Email sender attacker@example.com does not match expected recipient boss@example.com',
      );
    });

    it('loses the pending request when a reply from the wrong sender arrives first', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });
      await run.resume({
        step: ['await-email-response'],
        resumeData: { senderEmail: 'attacker@example.com', response: { approved: true } },
      });

      // The security check throws instead of suspending again, so the run is dead and
      // the genuine reply can never be applied.
      await expect(
        run.resume({
          step: ['await-email-response'],
          resumeData: { senderEmail: 'boss@example.com', response: { approved: true } },
        }),
      ).rejects.toThrow('This workflow run was not suspended');
    });

    it('refuses an empty sender rather than skipping the security check', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      const resumed = await run.resume({
        step: ['await-email-response'],
        resumeData: { senderEmail: '', response: { approved: true } },
      });

      // The guard used to read `if (senderEmail && ...)`, so a falsy sender skipped
      // validation and the approval was accepted from nobody. An absent address is not
      // evidence that the right person replied.
      assertStatus(resumed, 'failed');
    });

    it('rejects a response that does not match the schema', async () => {
      const { run } = await startFormRequest({ recipientEmail: 'boss@example.com', question: 'Approve?' });

      await expect(
        run.resume({
          step: ['await-email-response'],
          resumeData: { senderEmail: 'boss@example.com', response: { approved: 'yes please' } },
        }),
      ).rejects.toThrow(/response.approved: Invalid input: expected boolean, received string/);
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
          senderEmail: 'boss@example.com',
          response: { vendorName: 'Acme', justification: 'Cheapest bid' },
        },
      });

      assertStatus(resumed, 'success');
      expect(resumed.result.response).toEqual({ vendorName: 'Acme', justification: 'Cheapest bid' });
    });

    it('refuses a reply shaped for a different slug', async () => {
      const run = await vendorMastra.getWorkflow('awaitVendorSelectionWorkflow').createRun();
      await run.start({ inputData: { recipientEmail: 'boss@example.com', question: 'Which vendor?' } });

      await expect(
        run.resume({
          step: ['await-email-response'],
          resumeData: { senderEmail: 'boss@example.com', response: { approved: true } },
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

  async function startDemoRun(inputData: { recipientEmail?: string; projectName?: string; budgetAmount?: number }) {
    const run = await demoMastra.getWorkflow('humanInTheLoopDemoWorkflow').createRun();
    const started = await run.start({ inputData });
    return { run, started };
  }

  it('falls back to the demo recipient, project and budget', async () => {
    const { started } = await startDemoRun({});

    assertStatus(started, 'suspended');
    expect(started.input).toEqual({
      recipientEmail: 'demo@example.com',
      projectName: 'Demo Project',
      budgetAmount: 10000,
    });
    expect(sentEmails[0].toRecipients).toEqual(['demo@example.com']);
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

  it('walks approval, then vendor selection, then final confirmation', async () => {
    const { run } = await startDemoRun({
      recipientEmail: 'boss@example.com',
      projectName: 'Atlas',
      budgetAmount: 2500,
    });

    const afterApproval = await run.resume({
      step: budgetApprovalStep,
      resumeData: { senderEmail: 'boss@example.com', response: { approved: true, comments: 'Go ahead' } },
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
        senderEmail: 'boss@example.com',
        response: { vendorName: 'Acme', justification: 'Cheapest bid' },
      },
    });

    assertStatus(afterVendorSelection, 'suspended');
    expect(afterVendorSelection.suspended).toEqual([finalConfirmationStep]);
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails[2].subject).toContain('Final confirmation for project "Atlas" with vendor "Acme".');
  });

  it('sends the follow-up requests to the address that actually replied', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    await run.resume({
      step: budgetApprovalStep,
      // Accepted by the case-insensitive check, and from here on it becomes the recipient.
      resumeData: { senderEmail: 'BOSS@Example.com', response: { approved: true } },
    });

    expect(sentEmails[1].toRecipients).toEqual(['BOSS@Example.com']);
  });

  it('fails the run when the budget is rejected', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    const afterRejection = await run.resume({
      step: budgetApprovalStep,
      resumeData: { senderEmail: 'boss@example.com', response: { approved: false, comments: 'Too expensive' } },
    });

    // A rejection is an ordinary outcome, but the workflow throws instead of returning
    // the `approvalGranted: false` result its own output schema models.
    assertStatus(afterRejection, 'failed');
    expect(afterRejection.error.message).toBe('Budget was not approved - workflow cannot continue');
    expect(sentEmails).toHaveLength(1);
  });

  it('cannot reach its final output because the confirmation step is missing the vendor name', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com', projectName: 'Atlas' });
    await run.resume({
      step: budgetApprovalStep,
      resumeData: { senderEmail: 'boss@example.com', response: { approved: true } },
    });
    await run.resume({
      step: vendorSelectionStep,
      resumeData: { senderEmail: 'boss@example.com', response: { vendorName: 'Acme', justification: 'Cheapest' } },
    });

    const afterConfirmation = await run.resume({
      step: finalConfirmationStep,
      resumeData: { senderEmail: 'boss@example.com', response: { confirmed: true, finalNotes: 'Ship it' } },
    });

    // `extract-final-confirmation-response` expects `vendorName` "passed through from
    // prepareFinalConfirmationQuestion", but the nested send-and-wait workflow sits in
    // between and emits only `{ senderEmail, response }`. The happy path of the demo
    // therefore always dies on the last hop.
    assertStatus(afterConfirmation, 'failed');
    expect(afterConfirmation.error.message).toContain('vendorName: Invalid input: expected string, received undefined');
  });

  it('stops an empty sender at the security check, not two steps later', async () => {
    const { run } = await startDemoRun({ recipientEmail: 'boss@example.com' });

    const afterApproval = await run.resume({
      step: budgetApprovalStep,
      resumeData: { senderEmail: '', response: { approved: true } },
    });

    // Previously the approval was accepted and the run limped on, only dying once the
    // empty address was reused as the next recipient -- reported as
    // "recipientEmail: Invalid email address", which says nothing about the real problem.
    assertStatus(afterApproval, 'failed');
    expect(afterApproval.error.message).toContain('Security validation failed');
  });
});

describe('demo workflow steps in isolation', () => {
  /**
   * Steps are private to the module, but the committed workflow exposes them, so the
   * ones the demo graph can no longer reach are driven through a one-step harness.
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
    const run = await mastra.getWorkflow('harness').createRun();
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

    // The step itself is fine; only the graph feeding it is broken.
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
