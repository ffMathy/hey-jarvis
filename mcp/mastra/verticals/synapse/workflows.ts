import { z } from 'zod';
import { createMemory } from '../../memory/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { getStateChangeReactorAgent } from './agent.js';
import { describeStateChange } from './state-change.js';
import { findRelevantSubscriptions, formatSubscriptionMatches } from './subscription-matcher.js';

// State change notification workflow
// Receives state changes, saves to memory, and delegates to State Change Reactor agent for decision-making
export const stateChangeNotificationWorkflow = createWorkflow({
  id: 'stateChangeNotificationWorkflow',
  inputSchema: z.object({
    source: z.string(),
    stateType: z.string(),
    stateData: z.record(z.string(), z.unknown()),
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
        stateData: z.record(z.string(), z.unknown()),
      }),
      outputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.string(), z.unknown()),
        memorySaved: z.boolean(),
      }),
      execute: async ({ inputData }) => {
        logger.info('State change reactor processing', {
          source: inputData.source,
          stateType: inputData.stateType,
        });

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
      },
    }),
  )
  .then(
    createStep({
      id: 'match-subscriptions',
      description:
        'Finds subscriptions whose WHEN/GIVEN components semantically match the state change, using static Model2Vec embeddings',
      inputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.string(), z.unknown()),
        memorySaved: z.boolean(),
      }),
      outputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.string(), z.unknown()),
        matchedSubscriptions: z.string(),
        matchCount: z.number(),
      }),
      execute: async ({ inputData }) => {
        const description = describeStateChange(inputData);
        const matches = await findRelevantSubscriptions(description);

        logger.info('State change matched against subscriptions', {
          stateType: inputData.stateType,
          source: inputData.source,
          matchCount: matches.length,
        });

        return {
          source: inputData.source,
          stateType: inputData.stateType,
          stateData: inputData.stateData,
          matchedSubscriptions: formatSubscriptionMatches(matches),
          matchCount: matches.length,
        };
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
        stateData: z.record(z.string(), z.unknown()),
        matchedSubscriptions: z.string(),
        matchCount: z.number(),
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

Candidate subscriptions, retrieved by semantic similarity against their WHEN and GIVEN parts:

${inputData.matchedSubscriptions}

These candidates are suggestions, not decisions. For each one, confirm that its WHEN describes what actually happened and that its GIVEN (when present) currently holds. Carry out the THEN of every subscription that genuinely fires, and call markSubscriptionTriggered with its id afterwards.

Then analyze this state change using your working memory and context. Decide if the user should be notified or if any other action is needed. If you decide to notify, delegate to the Notification agent with a clear message to send.`;

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
      },
    }),
  )
  .commit();
