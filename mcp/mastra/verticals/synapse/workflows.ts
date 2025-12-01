import { z } from 'zod';
import { createMemory } from '../../memory/index.js';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { getNotificationAgent } from '../notification/agent.js';

// State change notification workflow
// Receives state changes, saves to memory, and delegates to Notification agent for analysis
export const stateChangeNotificationWorkflow = createWorkflow({
  id: 'stateChangeNotificationWorkflow',
  inputSchema: z.object({
    source: z.string(),
    stateType: z.string(),
    stateData: z.record(z.unknown()),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    analyzed: z.boolean(),
    notificationSent: z.boolean().optional(),
    reasoning: z.string().optional(),
  }),
})
  .then(
    createStep({
      id: 'save-to-memory',
      description: 'Saves state change to semantic memory for context and recall',
      inputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.unknown()),
      }),
      outputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.unknown()),
        memorySaved: z.boolean(),
      }),
      execute: async ({ inputData }) => {
        try {
          // Save to memory for semantic recall
          const memory = await createMemory();
          await memory.saveMessages({
            messages: [
              {
                id: `state-change-${Date.now()}`,
                role: 'system',
                content: {
                  format: 2,
                  parts: [
                    {
                      type: 'text',
                      text: `State change registered: ${inputData.stateType} from ${inputData.source}. Data: ${JSON.stringify(inputData.stateData)}`,
                    },
                  ],
                },
                createdAt: new Date(),
              },
            ],
          });

          console.log(`✅ State change saved to memory: ${inputData.stateType} from ${inputData.source}`);

          return {
            source: inputData.source,
            stateType: inputData.stateType,
            stateData: inputData.stateData,
            memorySaved: true,
          };
        } catch (error) {
          console.error('❌ Failed to save state change to memory:', error);
          throw error;
        }
      },
    }),
  )
  .then(
    createStep({
      id: 'analyze-state-change',
      description: 'Analyzes state change with Notification agent and determines if user notification is needed',
      inputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.unknown()),
        memorySaved: z.boolean(),
      }),
      outputSchema: z.object({
        registered: z.boolean(),
        analyzed: z.boolean(),
        notificationSent: z.boolean().optional(),
        reasoning: z.string().optional(),
      }),
      execute: async ({ inputData }) => {
        // Get the Notification agent directly
        const notificationAgent = await getNotificationAgent();

        // Construct analysis prompt with state change context
        const analysisPrompt = `A state change has been detected and saved to memory:

Source: ${inputData.source}
Type: ${inputData.stateType}
Data: ${JSON.stringify(inputData.stateData, null, 2)}

Please analyze this state change and determine if the user should be notified. 
Consider the context from semantic recall and only notify for significant, actionable changes.
If you decide to notify, use the notifyDevice tool to send the notification.
Always explain your reasoning.`;

        // Use generate() directly instead of network() to avoid routing complexity
        const result = await notificationAgent.generate(analysisPrompt);

        return {
          registered: true,
          analyzed: true,
          reasoning: result.text,
        };
      },
    }),
  )
  .commit();
