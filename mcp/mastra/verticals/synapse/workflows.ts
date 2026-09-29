import { z } from 'zod';
import { createMemory } from '../../memory/index.js';
import { getSubscriptionStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { getStateChangeReactorAgent } from './agent.js';
import { extractPreferences } from './preference-extraction.js';
import {
  applyPromotionPlan,
  extractedPreferenceSchema,
  planPromotion,
  promotionSubscriptionSchema,
  toPromotionSubscription,
} from './preference-promotion.js';
import { runStateChangeReactor } from './reactor-run.js';
import { describeStateChange } from './state-change.js';
import { STATE_CHANGE_RESOURCE_ID, STATE_CHANGE_THREAD_ID } from './state-change-notifier.js';
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

        // Saved for recent context, not for semantic recall: this is the same
        // per-state-change write the batcher makes, and embedding machine events with
        // the hosted model costs a round trip each to make them searchable by meaning.
        // See CreateMemoryOptions.enableSemanticRecall.
        const memory = await createMemory({ enableSemanticRecall: false });
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

        // Run the reactor as a supervisor - it decides what fires and delegates to the
        // Notification agent itself. Blocks until the whole delegation loop is done.
        const reasoning = await runStateChangeReactor(reactorAgent, analysisPrompt);

        if (reasoning.trim() === '') {
          return {
            registered: true,
            analyzed: false,
            reasoning: 'The reactor finished without producing a response.',
          };
        }

        return {
          registered: true,
          analyzed: true,
          reasoning,
        };
      },
    }),
  )
  .commit();

/**
 * Promotes the standing preferences in working memory to subscriptions.
 *
 * Which working memory: the State Change Reactor's, filed under
 * {@link STATE_CHANGE_RESOURCE_ID}. Working memory is resource-scoped (Mastra's default,
 * which `createMemory` keeps), and the reactor is the only agent that runs with a memory
 * resource at all — the conversational agents are reached through routing plans and the
 * MCP server, neither of which passes one, so they never read or write working memory.
 * The thread id is required by the API but not consulted for resource-scoped memory.
 *
 * Why a scheduled pass rather than a hook on every working-memory write: the write
 * happens inside the reactor's own tool loop, through Mastra's built-in
 * `updateWorkingMemory` tool, so reacting to it would mean wrapping Mastra's memory and
 * putting a model call inside every reactor run. And promoted subscriptions are leased
 * (see `PROMOTION_LEASE_MILLISECONDS`), so something has to run periodically to renew
 * them anyway — the same pass picks up new preferences and retires removed ones. A few
 * hours' delay is fine for preferences that stand for weeks.
 *
 * Failure is safe in every step: nothing is changed until the model's answer has passed
 * the schema, so a run that cannot read memory or reach the model leaves every
 * subscription as it was, and the leases carry them to the next run.
 */
export const promoteMemoryPreferencesWorkflow = createWorkflow({
  id: 'promoteMemoryPreferencesWorkflow',
  description: 'Turns standing preferences in working memory into leased Synapse subscriptions',
  inputSchema: z.object({}),
  outputSchema: z.object({
    created: z.number(),
    renewed: z.number(),
    retired: z.number(),
    skipped: z.number(),
  }),
})
  .then(
    createStep({
      id: 'read-working-memory',
      description: "Reads the reactor's working memory and every stored subscription",
      inputSchema: z.object({}),
      outputSchema: z.object({
        workingMemory: z.string().nullable(),
        subscriptions: z.array(promotionSubscriptionSchema),
      }),
      execute: async () => {
        const memory = await createMemory({ enableSemanticRecall: false });
        const workingMemory = await memory.getWorkingMemory({
          threadId: STATE_CHANGE_THREAD_ID,
          resourceId: STATE_CHANGE_RESOURCE_ID,
        });

        // Paused and lapsed rows included: a paused promoted subscription whose
        // preference still stands is renewed rather than duplicated, and a lapsed one is
        // brought back rather than joined by a copy.
        const storage = await getSubscriptionStorage();
        const subscriptions = await storage.list({ includeDisabled: true });

        return { workingMemory, subscriptions: subscriptions.map(toPromotionSubscription) };
      },
    }),
  )
  .then(
    createStep({
      id: 'extract-preferences',
      description: 'Reads WHEN/GIVEN/THEN out of the standing preferences, with structured output',
      inputSchema: z.object({
        workingMemory: z.string().nullable(),
        subscriptions: z.array(promotionSubscriptionSchema),
      }),
      outputSchema: z.object({
        preferences: z.array(extractedPreferenceSchema),
        subscriptions: z.array(promotionSubscriptionSchema),
      }),
      // A plain step rather than an agent step, so blank working memory skips the model
      // entirely instead of paying for a call whose answer is known.
      execute: async ({ inputData }) => ({
        preferences: await extractPreferences(inputData),
        subscriptions: inputData.subscriptions,
      }),
    }),
  )
  .then(
    createStep({
      id: 'apply-promotion',
      description: 'Creates, renews and retires the subscriptions promoted from working memory',
      inputSchema: z.object({
        preferences: z.array(extractedPreferenceSchema),
        subscriptions: z.array(promotionSubscriptionSchema),
      }),
      outputSchema: z.object({
        created: z.number(),
        renewed: z.number(),
        retired: z.number(),
        skipped: z.number(),
      }),
      execute: async ({ inputData }) => {
        const plan = planPromotion({ ...inputData, now: new Date() });
        return await applyPromotionPlan(plan, await getSubscriptionStorage());
      },
    }),
  )
  .commit();
