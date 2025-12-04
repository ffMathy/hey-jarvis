// Email vertical exports
export { getEmailAgent } from './agent.js';
export { emailTools } from './tools.js';
export {
  clearEmailTriggers,
  type EmailTriggerConfig,
  getRegisteredEmailTriggers,
  type RegisteredEmailTrigger,
  registerEmailTrigger,
  type TriggerableEmail,
  unregisterEmailTrigger,
} from './triggers.js';
export { checkForFormRepliesWorkflow, checkForNewEmails } from './workflows.js';
