import type { Mastra } from '@mastra/core';
import { z } from 'zod';
import { extractErrorMessage } from '../../utils/errors.js';
import { executeTool } from '../../utils/tool-factory.js';
import {
  createStep,
  createWorkflow,
  createWorkflowStateReader,
  type WorkflowSuspendedStep,
} from '../../utils/workflows/workflow-factory.js';
import { parseFormRequestSubject } from '../human-in-the-loop/workflows.js';
import { registerStateChange } from '../synapse/tools.js';
import { findNewEmailsSinceLastCheck, updateLastSeenEmail } from './tools.js';
import { processEmailTriggers } from './triggers.js';

/**
 * Id of the suspending step inside every send-and-wait workflow. A form reply can only be
 * applied to a run that is waiting on one of these, so the id is checked before resuming
 * rather than assuming any suspended run wants an email.
 */
const AWAIT_EMAIL_RESPONSE_STEP_ID = 'await-email-response';

/**
 * Creates an empty form reply processing result.
 * Used for early returns when there are no emails to process.
 */
const createEmptyFormReplyResult = (): {
  emailsProcessed: number;
  formRepliesFound: number;
  workflowsResumed: number;
  repliesRejected: number;
  errors: string[];
} => ({
  emailsProcessed: 0,
  formRepliesFound: 0,
  workflowsResumed: 0,
  repliesRejected: 0,
  errors: [],
});

/**
 * Shared Email Schema
 *
 * Common email object schema used across all email workflows.
 */
const emailObjectSchema = z.object({
  id: z.string(),
  subject: z.string(),
  bodyPreview: z.string(),
  body: z.object({
    contentType: z.string(),
    content: z.string(),
  }),
  from: z.object({
    name: z.string(),
    address: z.string(),
  }),
  receivedDateTime: z.string(),
  isRead: z.boolean(),
  hasAttachments: z.boolean(),
  isDraft: z.boolean(),
});

/**
 * Shared State Schema for Email Workflows
 *
 * Common state schema used by both email checking and form replies workflows.
 */
const sharedEmailStateSchema = z
  .object({
    newEmails: z.array(emailObjectSchema).default([]),
    isFirstCheck: z.boolean().default(false),
    lastCheckTimestamp: z.string().optional(),
    mostRecentEmailId: z.string().optional(),
    mostRecentEmailReceivedDateTime: z.string().optional(),
    /**
     * What processing the replies actually did.
     *
     * Carried in state because the steps between that work and the workflow's final
     * output do not thread it through their schemas, and a refused reply that appears
     * only in a console line is a refusal nobody finds. A scheduled run's own result
     * should say when it declined to apply an answer.
     */
    formReplyOutcome: z
      .object({
        workflowsResumed: z.number(),
        repliesRejected: z.number(),
        errors: z.array(z.string()),
      })
      .optional(),
  })
  .partial();

// ============================================================================
// FOLDER KEYS - Separate tracking for each workflow
// ============================================================================

/**
 * Folder key for email checking workflow (runs every minute).
 * This workflow uses its own storage key to track which emails have been seen.
 */
const EMAIL_CHECKING_FOLDER_KEY = 'inbox';

/**
 * Folder key for form replies detection workflow (runs every 3 hours).
 * Uses a separate storage key so it maintains its own "last seen" state
 * independent of the email checking workflow.
 */
const FORM_REPLIES_FOLDER_KEY = 'inbox-form-replies';

// ============================================================================
// SHARED STEPS - Reused by both workflows
// ============================================================================

/**
 * Creates a step to search for new emails since last check.
 * Each workflow uses its own folder key to track emails independently.
 */
const createSearchNewEmailsStep = (storageKey: string, stepId: string) =>
  createStep({
    id: stepId,
    description: 'Search for new emails received since the last workflow run',
    inputSchema: z.object({}),
    outputSchema: z.object({
      emails: z.array(emailObjectSchema),
      totalCount: z.number(),
      isFirstCheck: z.boolean(),
      lastCheckTimestamp: z.string().optional(),
    }),
    execute: async () => {
      return await findNewEmailsSinceLastCheck(storageKey, 'inbox', 50);
    },
  });

/**
 * Creates a step to update the last seen email state.
 * Each workflow uses its own folder key to maintain independent tracking.
 */
const createUpdateLastSeenEmailStep = (folderKey: string, stepId: string) =>
  createStep({
    id: stepId,
    description: 'Update the last seen email state after processing',
    stateSchema: sharedEmailStateSchema,
    inputSchema: z.object({
      emailCount: z.number(),
      isFirstCheck: z.boolean(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      folder: z.string(),
      previousLastSeenId: z.string().optional(),
      newLastSeenId: z.string(),
      emailCount: z.number(),
    }),
    execute: async ({ state, inputData }) => {
      if (!state.mostRecentEmailId || !state.mostRecentEmailReceivedDateTime) {
        return {
          success: false,
          message: 'No new emails to track',
          folder: folderKey,
          newLastSeenId: '',
          emailCount: inputData.emailCount,
        };
      }

      const result = await updateLastSeenEmail(
        folderKey,
        state.mostRecentEmailId,
        state.mostRecentEmailReceivedDateTime,
      );
      return {
        ...result,
        emailCount: inputData.emailCount,
      };
    },
  });

/**
 * Shared Step: Store new emails in workflow state
 *
 * Stores emails in state and tracks the most recent email for later update.
 */
const storeNewEmailsInState = createStep({
  id: 'store-new-emails-in-state',
  description: 'Store new emails in workflow state and track the most recent email for later update',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    emails: z.array(emailObjectSchema),
    totalCount: z.number(),
    isFirstCheck: z.boolean(),
    lastCheckTimestamp: z.string().optional(),
  }),
  outputSchema: z.object({
    emailCount: z.number(),
    isFirstCheck: z.boolean(),
  }),
  execute: async (params) => {
    const { emails, totalCount, isFirstCheck, lastCheckTimestamp } = params.inputData;

    const mostRecentEmail = emails.length > 0 ? emails[0] : undefined;

    params.setState({
      ...params.state,
      newEmails: emails,
      isFirstCheck,
      lastCheckTimestamp,
      mostRecentEmailId: mostRecentEmail?.id,
      mostRecentEmailReceivedDateTime: mostRecentEmail?.receivedDateTime,
    });

    console.log(
      `📬 Found ${totalCount} new email(s)${isFirstCheck ? ' (first check)' : ` since ${lastCheckTimestamp}`}`,
    );

    return {
      emailCount: totalCount,
      isFirstCheck,
    };
  },
});

// Create workflow-specific steps for email checking
const searchNewEmailsForChecking = createSearchNewEmailsStep(EMAIL_CHECKING_FOLDER_KEY, 'search-new-emails-checking');
const updateLastSeenEmailForChecking = createUpdateLastSeenEmailStep(
  EMAIL_CHECKING_FOLDER_KEY,
  'update-last-seen-email-checking',
);

// Create workflow-specific steps for form replies detection
const searchNewEmailsForFormReplies = createSearchNewEmailsStep(
  FORM_REPLIES_FOLDER_KEY,
  'search-new-emails-form-replies',
);

/**
 * Update last seen email step for form replies workflow.
 * Custom step (not using factory) because it comes after processEmailTriggersStep
 * which has a different output schema.
 */
const updateLastSeenEmailForFormReplies = createStep({
  id: 'update-last-seen-email-form-replies',
  description: 'Update the last seen email state after processing form replies',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    triggersProcessed: z.number(),
    triggersMatched: z.number(),
    matchedTriggerIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    folder: z.string(),
    previousLastSeenId: z.string().optional(),
    newLastSeenId: z.string(),
  }),
  execute: async ({ state }) => {
    if (!state.mostRecentEmailId || !state.mostRecentEmailReceivedDateTime) {
      return {
        success: false,
        message: 'No new emails to track',
        folder: FORM_REPLIES_FOLDER_KEY,
        newLastSeenId: '',
      };
    }

    return await updateLastSeenEmail(
      FORM_REPLIES_FOLDER_KEY,
      state.mostRecentEmailId,
      state.mostRecentEmailReceivedDateTime,
    );
  },
});

// ============================================================================
// EMAIL CHECKING WORKFLOW (Every minute)
// ============================================================================

/**
 * Format output for email checking workflow
 */
const formatEmailCheckingOutput = createStep({
  id: 'format-email-checking-output',
  description: 'Format the email checking workflow output',
  inputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    folder: z.string(),
    previousLastSeenId: z.string().optional(),
    newLastSeenId: z.string(),
    emailCount: z.number(),
  }),
  outputSchema: z.object({
    emailsFound: z.number(),
    lastSeenEmailUpdated: z.boolean(),
    message: z.string(),
  }),
  execute: async (params) => {
    const { emailCount } = params.inputData;
    const updateResult = params.inputData;

    return {
      emailsFound: emailCount,
      lastSeenEmailUpdated: updateResult.success && updateResult.newLastSeenId !== '',
      message:
        emailCount === 0
          ? 'No new emails since last check'
          : `Found ${emailCount} new email(s)${updateResult.success && updateResult.newLastSeenId !== '' ? `, updated last seen to ${updateResult.newLastSeenId}` : ''}`,
    };
  },
});

/**
 * Email Checking Workflow
 *
 * Simple workflow that checks for new emails every minute and updates tracking.
 * This workflow does NOT trigger the state reactor - it only tracks emails.
 * Uses its own storage key ('inbox') to track which emails have been seen.
 *
 * Scheduled to run every minute via the workflow scheduler.
 *
 * Workflow Steps:
 * 1. Search for new emails since last check
 * 2. Store emails in state
 * 3. Update last seen email tracking
 * 4. Format output
 */
export const emailCheckingWorkflow = createWorkflow({
  id: 'emailCheckingWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    emailsFound: z.number(),
    lastSeenEmailUpdated: z.boolean(),
    message: z.string(),
  }),
})
  .then(searchNewEmailsForChecking)
  .then(storeNewEmailsInState)
  .then(updateLastSeenEmailForChecking)
  .then(formatEmailCheckingOutput)
  .commit();

// ============================================================================
// FORM REPLIES DETECTION WORKFLOW (Every 3 hours)
// ============================================================================

/**
 * Whether the step a run is suspended on is one of the send-and-wait steps an email reply
 * can answer.
 */
function isAwaitingEmailReply(suspendedPath: string[] | undefined): boolean {
  const path = suspendedPath ?? [];
  return path[path.length - 1] === AWAIT_EMAIL_RESPONSE_STEP_ID;
}

/**
 * Says why a run that was found cannot take the reply that named it.
 *
 * "No run with that id" and "that run is not waiting for an email" used to share one
 * message, which hid the difference between a token pointing at nothing and a reply that
 * arrived after its question had already been answered.
 */
function describeRunThatCannotTakeTheReply(
  workflowId: string,
  runId: string,
  status: string,
  suspendedPath: string[] | undefined,
): string {
  if (status !== 'suspended') {
    return `Run ${runId} of ${workflowId} is not waiting for a reply; it is ${status}`;
  }

  if (!suspendedPath || suspendedPath.length === 0) {
    return `Run ${runId} of ${workflowId} is suspended, but its snapshot names no suspended step`;
  }

  return `Run ${runId} of ${workflowId} is suspended on ${suspendedPath.join(' > ')}, which is not an email question`;
}

/** A workflow as it comes back from the registry the reply handler searches. */
type RegisteredWorkflow = ReturnType<Mastra['listWorkflows']>[string];

/**
 * What the run named by a reply turned out to be.
 */
type RunLookup =
  | { kind: 'awaiting'; workflow: RegisteredWorkflow; suspendedStep: WorkflowSuspendedStep }
  | { kind: 'not-awaiting'; description: string }
  | { kind: 'not-found'; description: string };

/**
 * Finds the suspended run that a form reply belongs to.
 *
 * The subject carries a run id because that is the only identifier a step suspended
 * inside a nested workflow shares with the top-level run it belongs to. `getWorkflowRunById`
 * filters by the workflow's own name, so the owning workflow is found by asking each
 * registered workflow whether it holds that run — a handful of indexed lookups, on a job
 * that runs every three hours.
 *
 * `withNestedWorkflows: false` because nothing here needs the nested step results the
 * default recursively re-reads: a nested suspension is located from the top-level step's
 * own `__workflow_meta` path, which is in the snapshot either way.
 *
 * A run that is found but cannot take the reply does not end the search, because a run id
 * is only unique per workflow; the reason is reported only if no workflow is waiting.
 */
async function findRunAwaitingEmailReply(mastra: Mastra, runId: string): Promise<RunLookup> {
  let firstRunThatCannotTakeIt: string | undefined;

  for (const workflow of Object.values(mastra.listWorkflows())) {
    const state = await workflow.getWorkflowRunById(runId, { withNestedWorkflows: false });
    if (!state) {
      continue;
    }

    const suspendedStep =
      state.status === 'suspended' ? createWorkflowStateReader(state).getSuspendedStep() : undefined;

    const suspendedPath = suspendedStep?.path;

    if (suspendedStep && isAwaitingEmailReply(suspendedPath)) {
      return { kind: 'awaiting', workflow, suspendedStep };
    }

    firstRunThatCannotTakeIt ??= describeRunThatCannotTakeTheReply(workflow.id, runId, state.status, suspendedPath);
  }

  return firstRunThatCannotTakeIt
    ? { kind: 'not-awaiting', description: firstRunThatCannotTakeIt }
    : { kind: 'not-found', description: `No workflow run with id ${runId} was found` };
}

/**
 * The outcome of handing one inbound reply to the run it names.
 *
 * `rejected` is its own outcome rather than an error: the reply is one nobody can act on
 * — the wrong sender, an answer to a question that has already moved on, or text that
 * cannot be read as an answer — so it is declined and the run is left exactly as it was.
 * Nothing has gone wrong with the system, and the person who was asked can still answer.
 */
type FormReplyOutcome =
  | { kind: 'resumed'; description: string }
  | { kind: 'rejected'; description: string }
  | { kind: 'unmatched'; description: string };

/**
 * Picks the text of the reply to hand the parser.
 *
 * The full body carries the whole answer; `bodyPreview` is truncated and only stands in
 * when the body did not come back. Either can be blank, and blank is not an answer, so
 * nothing is passed on rather than a `''` the parsing agent would be asked to read
 * meaning into.
 */
function readReplyText(email: z.infer<typeof emailObjectSchema>): string | undefined {
  return [email.body.content, email.bodyPreview].find((text) => text.trim() !== '');
}

/**
 * Hands one reply to the suspended run named in its subject.
 *
 * Both halves of the subject token are used: the run id finds the run, and the request id
 * is handed to the suspended step, which accepts the reply only if it is the answer to the
 * request it is actually waiting on.
 *
 * A run left suspended at the same step is how a refusal is told apart from an answer that
 * moved the run on: an accepted answer either finishes the run or suspends it somewhere
 * else, on its next question.
 */
async function applyFormReply(
  mastra: Mastra,
  email: z.infer<typeof emailObjectSchema>,
  { runId, requestId }: { runId: string; requestId: string },
): Promise<FormReplyOutcome> {
  const pendingRun = await findRunAwaitingEmailReply(mastra, runId);
  if (pendingRun.kind === 'not-found') {
    return { kind: 'unmatched', description: pendingRun.description };
  }

  if (pendingRun.kind === 'not-awaiting') {
    return { kind: 'rejected', description: `Reply from ${email.from.address} was refused: ${pendingRun.description}` };
  }

  const { workflow, suspendedStep } = pendingRun;
  const run = await workflow.createRun({ runId });
  const resumed = await run.resume({
    step: suspendedStep.path,
    resumeData: {
      requestId,
      senderEmail: email.from.address,
      replyBody: readReplyText(email),
    },
  });

  if (resumed.status === 'failed') {
    const detail = extractErrorMessage(resumed.error) ?? 'no reason was reported';
    throw new Error(`Resuming ${workflow.id} run ${runId} failed: ${detail}`);
  }

  const stillWaitingForTheSameAnswer =
    resumed.status === 'suspended' &&
    resumed.suspended.some((path) => path.join(' > ') === suspendedStep.path.join(' > '));

  if (stillWaitingForTheSameAnswer) {
    return {
      kind: 'rejected',
      description: `Reply from ${email.from.address} was refused; run ${runId} is still waiting`,
    };
  }

  return { kind: 'resumed', description: `Resumed ${workflow.id} run ${runId} (now ${resumed.status})` };
}

/**
 * Process form replies and resume the runs waiting for them.
 *
 * A reply carries, in its subject, the id of the suspended run and the id of the request
 * it answers. The run is recovered from storage, and the reply is handed to the step that
 * suspended, which checks that the reply answers the request it is still waiting on,
 * validates the sender, and parses the free text into the answer it expects. A reply that
 * step refuses leaves the run suspended at the same place, which is how a refusal is told
 * apart from an answer that moved the run on to its next question.
 */
const processFormReplies = createStep({
  id: 'process-form-replies',
  description: 'Process emails to find the suspended runs they answer, and resume them',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    emailCount: z.number(),
    isFirstCheck: z.boolean(),
  }),
  outputSchema: z.object({
    emailsProcessed: z.number(),
    formRepliesFound: z.number(),
    workflowsResumed: z.number(),
    repliesRejected: z.number(),
    errors: z.array(z.string()),
  }),
  execute: async (params) => {
    const { newEmails = [] } = params.state;
    let emailsProcessed = 0;
    let formRepliesFound = 0;
    let workflowsResumed = 0;
    let repliesRejected = 0;
    const errors: string[] = [];

    if (newEmails.length === 0) {
      console.log('⏭️  No emails to process for form replies');
      return createEmptyFormReplyResult();
    }

    console.log(`🔍 Processing ${newEmails.length} email(s) for form replies...`);

    for (const email of newEmails) {
      try {
        emailsProcessed++;

        const formRequest = parseFormRequestSubject(email.subject);
        if (!formRequest) continue;

        formRepliesFound++;
        const { runId, requestId } = formRequest;
        console.log(`✅ Found reply to request ${requestId} of run ${runId} from ${email.from.address}`);

        if (!params.mastra) {
          throw new Error('Mastra instance not available');
        }

        const outcome = await applyFormReply(params.mastra, email, formRequest);
        if (outcome.kind === 'resumed') {
          workflowsResumed++;
          console.log(`▶️  ${outcome.description}`);
        } else if (outcome.kind === 'rejected') {
          repliesRejected++;
          console.log(`🚫 ${outcome.description}`);
        } else {
          errors.push(outcome.description);
        }
      } catch (error) {
        const errorMessage = `Error processing email "${email.subject}": ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMessage);
        console.error(`❌ ${errorMessage}`);
      }
    }

    console.log(`\n📊 Form reply processing summary:`);
    console.log(`   Emails processed: ${emailsProcessed}`);
    console.log(`   Form replies found: ${formRepliesFound}`);
    console.log(`   Workflows resumed: ${workflowsResumed}`);
    console.log(`   Replies rejected: ${repliesRejected}`);
    console.log(`   Errors: ${errors.length}`);

    params.setState({ ...params.state, formReplyOutcome: { workflowsResumed, repliesRejected, errors } });

    return { emailsProcessed, formRepliesFound, workflowsResumed, repliesRejected, errors };
  },
});

/**
 * Register emails as state change for notification system
 *
 * This step triggers the state reactor to analyze emails and potentially notify users.
 */
const registerEmailsStateChange = createStep({
  id: 'register-emails-state-change',
  description: 'Register new emails as state change for notification system (triggers state reactor)',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    emailsProcessed: z.number(),
    formRepliesFound: z.number(),
    workflowsResumed: z.number(),
    repliesRejected: z.number(),
    errors: z.array(z.string()),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    batched: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ state, inputData, mastra }) => {
    const emails = state.newEmails ?? [];

    if (emails.length === 0) {
      console.log('⏭️  No emails to register with state reactor');
      return {
        registered: false,
        batched: false,
        message: 'No emails to register',
      };
    }

    const stateChangeData = {
      source: 'email',
      stateType: 'new_emails_received',
      stateData: {
        emailCount: emails.length,
        formRepliesFound: inputData.formRepliesFound,
        workflowsResumed: inputData.workflowsResumed,
        repliesRejected: inputData.repliesRejected,
        emails: emails.map((email: z.infer<typeof emailObjectSchema>) => ({
          subject: email.subject,
          from: email.from.address,
          receivedDateTime: email.receivedDateTime,
        })),
        timestamp: new Date().toISOString(),
      },
    };

    console.log(`📝 Registering ${emails.length} email(s) with state reactor...`);
    return await executeTool(registerStateChange, stateChangeData, { mastra });
  },
});

/**
 * Process email triggers step
 *
 * This step processes emails against registered email triggers and executes
 * matching workflows in parallel.
 */
const processEmailTriggersStep = createStep({
  id: 'process-email-triggers',
  description: 'Process emails against registered email triggers',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    registered: z.boolean(),
    batched: z.boolean(),
    message: z.string(),
  }),
  outputSchema: z.object({
    triggersProcessed: z.number(),
    triggersMatched: z.number(),
    matchedTriggerIds: z.array(z.string()),
  }),
  execute: async ({ state }) => {
    const emails = state.newEmails ?? [];

    if (emails.length === 0) {
      return {
        triggersProcessed: 0,
        triggersMatched: 0,
        matchedTriggerIds: [],
      };
    }

    console.log(`📧 Processing ${emails.length} email(s) against registered triggers...`);

    const allMatchedIds: string[] = [];

    for (const email of emails) {
      const matchedIds = await processEmailTriggers({
        id: email.id,
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        body: email.body,
        from: email.from,
        receivedDateTime: email.receivedDateTime,
      });

      allMatchedIds.push(...matchedIds);
    }

    console.log(`📧 Triggers matched: ${allMatchedIds.length} for ${emails.length} email(s)`);

    return {
      triggersProcessed: emails.length,
      triggersMatched: allMatchedIds.length,
      matchedTriggerIds: allMatchedIds,
    };
  },
});

/**
 * Format output for form replies detection workflow
 */
const formatFormRepliesOutput = createStep({
  id: 'format-form-replies-output',
  description: 'Format the form replies detection workflow output',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    folder: z.string(),
    previousLastSeenId: z.string().optional(),
    newLastSeenId: z.string(),
  }),
  outputSchema: z.object({
    emailsFound: z.number(),
    formRepliesDetected: z.number(),
    workflowsResumed: z.number(),
    repliesRejected: z.number(),
    errors: z.array(z.string()),
    stateChangeRegistered: z.boolean(),
    message: z.string(),
  }),
  execute: async (params) => {
    const emails = params.state.newEmails ?? [];

    const formRepliesCount = emails.filter(
      (email: z.infer<typeof emailObjectSchema>) => parseFormRequestSubject(email.subject) !== undefined,
    ).length;

    const outcome = params.state.formReplyOutcome ?? { workflowsResumed: 0, repliesRejected: 0, errors: [] };

    // A refusal is reported alongside the counts rather than buried, because "we saw a
    // reply and deliberately did not apply it" is the one outcome an operator has to act
    // on -- somebody is waiting on an approval that is not going to arrive.
    const appliedSummary =
      outcome.repliesRejected > 0
        ? `, resumed ${outcome.workflowsResumed}, refused ${outcome.repliesRejected}`
        : outcome.workflowsResumed > 0
          ? `, resumed ${outcome.workflowsResumed}`
          : '';

    return {
      emailsFound: emails.length,
      formRepliesDetected: formRepliesCount,
      workflowsResumed: outcome.workflowsResumed,
      repliesRejected: outcome.repliesRejected,
      errors: outcome.errors,
      stateChangeRegistered: emails.length > 0,
      message:
        emails.length === 0
          ? 'No new emails to analyze'
          : `Analyzed ${emails.length} email(s), found ${formRepliesCount} form ${formRepliesCount === 1 ? 'reply' : 'replies'}${appliedSummary}`,
    };
  },
});

/**
 * Form Replies Detection Workflow
 *
 * Workflow that processes emails for form replies and triggers the state reactor.
 * This workflow runs less frequently (every 3 hours) and is responsible for:
 * 1. Detecting form reply emails (with the [RUN-{runId}/REQ-{requestId}] token)
 * 2. Resuming the suspended runs those replies answer
 * 3. Registering state changes to trigger notifications
 *
 * Uses its own storage key ('inbox-form-replies') to track which emails have been
 * processed, independent of the email checking workflow.
 *
 * Scheduled to run every 3 hours via the workflow scheduler.
 *
 * Workflow Steps:
 * 1. Search for new emails since last check
 * 2. Store emails in state
 * 3. Process form replies (read the subject token, resume the run that request belongs to)
 * 4. Register state change (triggers state reactor for notifications)
 * 5. Update last seen email tracking
 * 6. Format output
 */
export const formRepliesDetectionWorkflow = createWorkflow({
  id: 'formRepliesDetectionWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    emailsFound: z.number(),
    formRepliesDetected: z.number(),
    workflowsResumed: z.number(),
    repliesRejected: z.number(),
    errors: z.array(z.string()),
    stateChangeRegistered: z.boolean(),
    message: z.string(),
  }),
})
  .then(searchNewEmailsForFormReplies)
  .then(storeNewEmailsInState)
  .then(processFormReplies)
  .then(registerEmailsStateChange)
  .then(processEmailTriggersStep)
  .then(updateLastSeenEmailForFormReplies)
  .then(formatFormRepliesOutput)
  .commit();
