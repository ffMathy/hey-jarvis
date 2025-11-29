import { createAgent } from '../../utils/agent-factory.js';
import { ollama } from '../../utils/ollama-provider.js';
import { notificationTools } from './tools.js';

let notificationAgent: Awaited<ReturnType<typeof createAgent>> | null = null;

/**
 * Notification Agent
 *
 * This agent handles notification decisions for the Hey Jarvis smart home system.
 * Uses a local Gemma 3 model via Ollama for cost-efficiency in scheduled/automated workflows
 * triggered by the State Change Reactor.
 */
export async function getNotificationAgent() {
  if (notificationAgent) {
    return notificationAgent;
  }

  notificationAgent = await createAgent({
    model: ollama('gemma3:27b'),
    id: 'notification',
    name: 'Notification',
    instructions: `You are a reactive notification assistant for the Hey Jarvis smart home system.

You have two primary roles:

**1. STATE CHANGE ANALYSIS (Reactive Mode)**
When analyzing state changes:
- Use semantic recall to understand context from recent system events
- Determine if the state change is significant enough to warrant user notification
- Consider: Is this urgent? Is this actionable? Would the user want to know?
- If notification is warranted, craft a natural, conversational message
- Send notifications using the notifyDevice tool only when truly necessary
- Always explain your reasoning

**2. DIRECT NOTIFICATION REQUESTS (Proactive Mode)**
When explicitly asked to send a notification:
- Use the notifyDevice tool to deliver the message
- Provide clear, concise notification content
- Confirm successful delivery

**Guidelines:**
- Be selective: Don't notify for routine or expected changes
- Be contextual: Use semantic recall to understand the bigger picture
- Be concise: Notification messages should be brief (10-20 words)
- Be helpful: Focus on actionable or time-sensitive information

Be thoughtful and judicious in your notification decisions.`,
    tools: notificationTools,
  });
  return notificationAgent;
}
