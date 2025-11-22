import { z } from 'zod';
import { createMemory } from '../../memory/index.js';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';

// State change notification workflow
// Receives state changes, saves to memory, and delegates to State Change Reactor agent for analysis
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
      id: 'delegate-to-reactor',
      description: 'Delegates state change to State Change Reactor agent for coordination',
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
      execute: async ({ inputData, mastra }) => {
        if (!mastra) {
          throw new Error('Mastra instance not available');
        }

        // Get the State Change Reactor agent
        const reactorAgent = mastra.getAgent('stateChangeReactor');
        if (!reactorAgent) {
          throw new Error('State Change Reactor agent not found');
        }

        // Construct delegation prompt with state change context
        const delegationPrompt = `A state change has been detected and saved to memory:

Source: ${inputData.source}
Type: ${inputData.stateType}
Data: ${JSON.stringify(inputData.stateData, null, 2)}

Please delegate this to the Notification agent for analysis and potential user notification.`;

        // Execute agent network to delegate to notification agent
        const networkStream = await reactorAgent.network(delegationPrompt);

        // Wait for the network execution to complete
        const workflowResult = await networkStream.result;

        if (!workflowResult) {
          return {
            registered: true,
            analyzed: false,
            reasoning: 'No result from agent network',
          };
        }

        return {
          registered: true,
          analyzed: true,
        };
      },
    }),
  )
  .commit();
