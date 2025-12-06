import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { findNewEmailsSinceLastCheck, updateLastSeenEmail } from './tools.js';
import { processEmailTriggers } from './triggers.js';

/**
 * Regex pattern to extract workflow ID from email subjects.
 * Matches: [WF-{workflowId}]
 * Example: "Re: Form Request [WF-abc123]: Please approve..."
 */
const WORKFLOW_ID_REGEX = /\[WF-([^\]]+)\]/;

/**
 * Creates an empty form reply processing result.
 * Used for early returns when there are no emails to process.
 */
const createEmptyFormReplyResult = () => ({
  emailsProcessed: 0,
  formRepliesFound: 0,
  workflowsResumed: 0,
  errors: [] as string[],
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
const createSearchNewEmailsStep = (folderKey: string, stepId: string) =>
  createStep({
    id: stepId,
    description: 'Search for new emails received since the last workflow run',
    stateSchema: sharedEmailStateSchema,
    inputSchema: z.object({}),
    outputSchema: z.object({
      emails: z.array(emailObjectSchema),
      totalCount: z.number(),
      isFirstCheck: z.boolean(),
      lastCheckTimestamp: z.string().optional(),
    }),
    execute: async () => {
      return await findNewEmailsSinceLastCheck(folderKey, 50);
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
    }),
    execute: async ({ state }) => {
      if (!state.mostRecentEmailId || !state.mostRecentEmailReceivedDateTime) {
        return {
          success: false,
          message: 'No new emails to track',
          folder: folderKey,
          newLastSeenId: '',
        };
      }

      return await updateLastSeenEmail(folderKey, state.mostRecentEmailId, state.mostRecentEmailReceivedDateTime);
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
    const { emails, isFirstCheck, lastCheckTimestamp } = params.inputData;

    console.log(
      `📬 Found ${emails.length} new email(s)${isFirstCheck ? ' (first check)' : ` since ${lastCheckTimestamp}`}`,
    );

    const mostRecentEmail = emails.length > 0 ? emails[0] : undefined;

    params.setState({
      ...params.state,
      newEmails: emails,
      isFirstCheck,
      lastCheckTimestamp,
      mostRecentEmailId: mostRecentEmail?.id,
      mostRecentEmailReceivedDateTime: mostRecentEmail?.receivedDateTime,
    });

    return {
      emailCount: emails.length,
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
const updateLastSeenEmailForFormReplies = createUpdateLastSeenEmailStep(
  FORM_REPLIES_FOLDER_KEY,
  'update-last-seen-email-form-replies',
);

// ============================================================================
// EMAIL CHECKING WORKFLOW (Every minute)
// ============================================================================

/**
 * Format output for email checking workflow
 */
const formatEmailCheckingOutput = createStep({
  id: 'format-email-checking-output',
  description: 'Format the email checking workflow output',
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
    lastSeenEmailUpdated: z.boolean(),
    message: z.string(),
  }),
  execute: async (params) => {
    const emails = params.state.newEmails ?? [];
    const updateResult = params.inputData;

    return {
      emailsFound: emails.length,
      lastSeenEmailUpdated: updateResult.success && updateResult.newLastSeenId !== '',
      message:
        emails.length === 0
          ? 'No new emails since last check'
          : `Found ${emails.length} new email(s)${updateResult.success && updateResult.newLastSeenId !== '' ? `, updated last seen to ${updateResult.newLastSeenId}` : ''}`,
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
  stateSchema: sharedEmailStateSchema,
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
 * Process form replies and extract workflow IDs
 */
const processFormReplies = createStep({
  id: 'process-form-replies',
  description: 'Process emails to extract workflow IDs and attempt to resume workflows',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({
    emailCount: z.number(),
    isFirstCheck: z.boolean(),
  }),
  outputSchema: z.object({
    emailsProcessed: z.number(),
    formRepliesFound: z.number(),
    workflowsResumed: z.number(),
    errors: z.array(z.string()),
  }),
  execute: async (params) => {
    const { newEmails = [] } = params.state;
    let emailsProcessed = 0;
    let formRepliesFound = 0;
    const workflowsResumed = 0;
    const errors: string[] = [];

    if (newEmails.length === 0) {
      console.log('⏭️  No emails to process for form replies');
      return createEmptyFormReplyResult();
    }

    console.log(`🔍 Processing ${newEmails.length} email(s) for form replies...`);

    for (const email of newEmails) {
      try {
        emailsProcessed++;

        const match = email.subject.match(WORKFLOW_ID_REGEX);
        if (!match) {
          continue;
        }

        formRepliesFound++;
        const workflowId = match[1];
        console.log(`✅ Found form reply with workflow ID: ${workflowId} from ${email.from.address}`);

        if (!params.mastra) {
          throw new Error('Mastra instance not available');
        }

        const workflow = params.mastra.getWorkflow('humanInTheLoopDemoWorkflow');
        if (!workflow) {
          errors.push(`Workflow 'humanInTheLoopDemoWorkflow' not found for ID ${workflowId}`);
          continue;
        }

        console.log(`⚠️  Workflow run retrieval not yet implemented. Skipping workflow ${workflowId}`);
        errors.push(`Workflow run retrieval not implemented for ${workflowId}`);
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
    console.log(`   Errors: ${errors.length}`);

    return { emailsProcessed, formRepliesFound, workflowsResumed, errors };
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
    errors: z.array(z.string()),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    batched: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ state, inputData }) => {
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
        emails: emails.map((email) => ({
          subject: email.subject,
          from: email.from.address,
          receivedDateTime: email.receivedDateTime,
        })),
        timestamp: new Date().toISOString(),
      },
    };

    console.log(`📝 Registering ${emails.length} email(s) with state reactor...`);
    const result = await registerStateChange.execute(stateChangeData);

    if ('error' in result) {
      throw new Error(`Failed to register state change: ${result.message}`);
    }

    return result;
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
    emailCount: z.number(),
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
    stateChangeRegistered: z.boolean(),
    message: z.string(),
  }),
  execute: async (params) => {
    const emails = params.state.newEmails ?? [];

    const formRepliesCount = emails.filter((email) => WORKFLOW_ID_REGEX.test(email.subject)).length;

    return {
      emailsFound: emails.length,
      formRepliesDetected: formRepliesCount,
      stateChangeRegistered: emails.length > 0,
      message:
        emails.length === 0
          ? 'No new emails to analyze'
          : `Analyzed ${emails.length} email(s), found ${formRepliesCount} form ${formRepliesCount === 1 ? 'reply' : 'replies'}`,
    };
  },
});

/**
 * Form Replies Detection Workflow
 *
 * Workflow that processes emails for form replies and triggers the state reactor.
 * This workflow runs less frequently (every 3 hours) and is responsible for:
 * 1. Detecting form reply emails (with [WF-{id}] pattern)
 * 2. Attempting to resume suspended workflows
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
 * 3. Process form replies (extract workflow IDs, resume workflows)
 * 4. Register state change (triggers state reactor for notifications)
 * 5. Update last seen email tracking
 * 6. Format output
 */
export const formRepliesDetectionWorkflow = createWorkflow({
  id: 'formRepliesDetectionWorkflow',
  stateSchema: sharedEmailStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({
    emailsFound: z.number(),
    formRepliesDetected: z.number(),
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

// ============================================================================
// LEGACY EXPORTS (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use emailCheckingWorkflow instead
 */
export const checkForNewEmails = emailCheckingWorkflow;

/**
 * @deprecated Use formRepliesDetectionWorkflow instead
 */
export const checkForFormRepliesWorkflow = formRepliesDetectionWorkflow;
