import { createAgent } from '../../utils/agent-factory.js';
import { ollamaModel } from '../../utils/ollama-provider.js';
import { notificationTools } from './tools.js';

let notificationAgent: Awaited<ReturnType<typeof createAgent>> | null = null;

/**
 * Notification Agent
 *
 * This agent is responsible for SENDING notifications to users.
 * It does NOT decide whether to notify - that decision is made by the State Change Reactor.
 *
 * When called, it will always send the notification as requested.
 * Uses a local Qwen3 model via Ollama for cost-efficiency.
 */
export async function getNotificationAgent() {
  if (notificationAgent) {
    return notificationAgent;
  }

  notificationAgent = await createAgent({
    model: ollamaModel,
    id: 'notification',
    name: 'Notification',
    description: 'Sends notifications to users. Always sends the notification when asked.',
    instructions: `You are a notification delivery agent for the Hey Jarvis smart home system.

Your ONLY job is to send notifications when asked. You do NOT decide whether to notify - that decision has already been made by the agent that called you.

**Your Role:**
- Receive notification requests with a message to send
- Use the notifyDevice tool to deliver the notification
- Confirm successful delivery

**Guidelines:**
- ALWAYS send the notification when asked - the decision to notify has already been made
- Keep the message concise and clear (10-20 words ideal)
- If a message is provided, send it as-is or slightly refine for clarity
- If no specific message is provided, craft a brief, helpful notification based on the context
- Confirm delivery after sending

**Example:**
Request: "Send notification: Temperature dropped to 2°C - bring in your plants!"
Action: Use notifyDevice tool with the message
Response: "Notification sent successfully."`,
    tools: notificationTools,
  });

  return notificationAgent;
}
