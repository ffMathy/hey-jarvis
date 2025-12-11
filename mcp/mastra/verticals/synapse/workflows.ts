import { z } from 'zod';
import { createMemory } from '../../memory/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { getStateChangeReactorAgent } from './agent.js';

// State change notification workflow
// Receives state changes, saves to memory, and delegates to State Change Reactor agent for decision-making
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
        logger.info('State change reactor processing', {
          source: inputData.source,
          stateType: inputData.stateType,
        });

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

          logger.info('State change saved to memory', {
            stateType: inputData.stateType,
            source: inputData.source,
          });

          return {
            source: inputData.source,
            stateType: inputData.stateType,
            stateData: inputData.stateData,
            memorySaved: true,
          };
        } catch (error) {
          logger.error('Failed to save state change to memory', { error });
          throw error;
        }
      },
    }),
  )
  .then(
    createStep({
      id: 'analyze-and-decide',
      description: 'State Change Reactor analyzes the change and decides what actions to take',
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
        const reactorAgent = await getStateChangeReactorAgent();

        // Construct the analysis prompt - the reactor will decide what to do
        const analysisPrompt = `A state change has been detected:

Source: ${inputData.source}
Type: ${inputData.stateType}
Data: ${JSON.stringify(inputData.stateData, null, 2)}

Analyze this state change using your working memory and context. Decide if the user should be notified or if any other action is needed. If you decide to notify, delegate to the Notification agent with a clear message to send.`;

        try {
          // Execute agent network - the reactor will decide and potentially call notification agent
          const networkStream = await reactorAgent.network(analysisPrompt);

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
        } catch (error) {
          mastra.getLogger()?.error('Failed to execute agent network:', error);
          return {
            registered: true,
            analyzed: false,
            reasoning: `Network execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    }),
  )
  .commit();
