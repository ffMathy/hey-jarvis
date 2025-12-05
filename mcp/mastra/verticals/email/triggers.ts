import type { Workflow } from '@mastra/core/workflows';

/**
 * Configuration for registering an email trigger.
 * Email triggers allow workflows to be executed when emails matching specific criteria are received.
 */
export interface EmailTriggerConfig {
  /** Email address of the sender to match (case-insensitive) */
  sender: string;
  /** Function to filter emails by subject line */
  subjectFilter: (subject: string) => boolean;
  /** The workflow to trigger when a matching email is received */
  workflow: Workflow;
}

/**
 * Registered email trigger with unique ID for management.
 */
export interface RegisteredEmailTrigger extends EmailTriggerConfig {
  /** Unique identifier for this trigger */
  id: string;
}

/**
 * Email message structure passed to triggered workflows.
 */
export interface TriggerableEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: string;
    content: string;
  };
  from: {
    name: string;
    address: string;
  };
  receivedDateTime: string;
}

// Internal registry of email triggers
const emailTriggerRegistry: Map<string, RegisteredEmailTrigger> = new Map();

// Counter for generating unique trigger IDs
let triggerIdCounter = 0;

/**
 * Registers an email trigger that will execute a workflow when a matching email is received.
 *
 * @param config - The trigger configuration
 * @returns The unique ID of the registered trigger
 *
 * @example
 * ```typescript
 * import { registerEmailTrigger } from './triggers.js';
 * import { orderChangedWorkflow } from './workflows.js';
 *
 * registerEmailTrigger({
 *   sender: 'info@kundeservice.bilkatogo.dk',
 *   subjectFilter: (subject) => subject.includes('Din ordre er klar med følgende ændringer'),
 *   workflow: orderChangedWorkflow,
 * });
 * ```
 */
export function registerEmailTrigger(config: EmailTriggerConfig): string {
  const id = `email-trigger-${++triggerIdCounter}`;

  const trigger: RegisteredEmailTrigger = {
    ...config,
    id,
  };

  emailTriggerRegistry.set(id, trigger);

  console.log(`📧 Registered email trigger: ${id} for sender "${config.sender}"`);

  return id;
}

/**
 * Unregisters an email trigger by its ID.
 *
 * @param triggerId - The ID of the trigger to unregister
 * @returns true if the trigger was found and removed, false otherwise
 */
export function unregisterEmailTrigger(triggerId: string): boolean {
  const removed = emailTriggerRegistry.delete(triggerId);

  if (removed) {
    console.log(`📧 Unregistered email trigger: ${triggerId}`);
  }

  return removed;
}

/**
 * Gets all registered email triggers.
 *
 * @returns Array of all registered email triggers
 */
export function getRegisteredEmailTriggers(): RegisteredEmailTrigger[] {
  return Array.from(emailTriggerRegistry.values());
}

/**
 * Processes an incoming email against all registered triggers.
 * For each matching trigger, executes the associated workflow.
 *
 * @param email - The email to process
 * @returns Array of trigger IDs that matched and were executed
 */
export async function processEmailTriggers(email: TriggerableEmail): Promise<string[]> {
  const matchedTriggerIds: string[] = [];
  const senderAddress = email.from.address.toLowerCase();

  for (const trigger of emailTriggerRegistry.values()) {
    const triggerSender = trigger.sender.toLowerCase();

    if (senderAddress === triggerSender && trigger.subjectFilter(email.subject)) {
      console.log(`📧 Email trigger matched: ${trigger.id} for email "${email.subject}"`);

      try {
        const run = await trigger.workflow.createRun();
        await run.start({
          inputData: {
            email,
          },
        });

        matchedTriggerIds.push(trigger.id);
        console.log(`✅ Successfully executed workflow for trigger ${trigger.id}`);
      } catch (error) {
        console.error(`❌ Failed to execute workflow for trigger ${trigger.id}:`, error);
      }
    }
  }

  return matchedTriggerIds;
}

/**
 * Clears all registered email triggers.
 * Mainly useful for testing.
 */
export function clearEmailTriggers(): void {
  emailTriggerRegistry.clear();
  console.log('📧 Cleared all email triggers');
}
