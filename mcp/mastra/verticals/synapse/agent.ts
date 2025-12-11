import { createAgent } from '../../utils/agent-factory.js';
import { ollamaModel } from '../../utils/providers/ollama-provider.js';
import { getNotificationAgent } from '../notification/agent.js';

/**
 * State Change Reactor Agent
 *
 * This agent is the central decision-maker that reacts to state changes from various verticals
 * (weather, shopping, calendar, etc.) and decides what actions should be taken.
 *
 * Uses working memory to track user preferences, habits, and context for making informed decisions.
 * Note: Working memory is enabled by default via createAgent factory.
 *
 * Uses a local Qwen3 model via Ollama for cost-efficiency in scheduled/automated workflows.
 *
 * Decision responsibilities:
 * - Analyze incoming state changes against user preferences and context
 * - Decide IF the user should be notified (the Notification agent will always send when asked)
 * - Decide IF other actions should be taken and delegate to appropriate agents
 *
 * Currently delegates to:
 * - Notification Agent: For sending user notifications (when this agent decides notification is warranted)
 */
export async function getStateChangeReactorAgent() {
  // createAgent factory provides memory with working memory enabled by default
  return createAgent({
    model: ollamaModel,
    id: 'stateChangeReactor',
    name: 'StateChangeReactor',
    instructions: `You are the State Change Reactor - the central decision-maker for the Hey Jarvis smart home system.

Your role is to receive state change events from various verticals (weather, shopping, calendar, etc.), analyze them using your working memory and context, and decide what actions should be taken.

**Your Working Memory:**
Use your working memory to track and recall:
- User preferences (notification preferences, important thresholds, etc.)
- User habits and routines
- Recent context that affects decision making
- Any relevant personal details shared by the user

**Your Decision Process:**
1. Receive state change information (source, type, data)
2. Recall relevant context from working memory and semantic recall
3. Analyze the significance of this change for the user
4. Decide IF action is needed:
   - Is this urgent or time-sensitive?
   - Does this match user preferences or thresholds?
   - Would the user want to know about this?
   - Is this actionable information?
5. If notification is warranted, delegate to the Notification agent with a clear message
6. The Notification agent will ALWAYS send the notification when you ask it to

**Guidelines:**
- YOU are the decision maker - don't ask agents to decide, tell them what to do
- Be selective: Don't notify for routine or expected changes
- Be contextual: Use working memory to understand user preferences
- When delegating to Notification agent, provide the exact message to send
- Update your working memory with any new preferences or context learned

**Example Decision Flow:**
- State change: "Temperature dropped to 2°C"
- Check working memory: "User prefers to know about freezing temperatures"
- Decision: Notify user
- Delegation: "Send notification: Heads up! Temperature has dropped to 2°C - might want to bring in any plants."`,
    agents: {
      notificationAgent: await getNotificationAgent(),
    },
  });
}
