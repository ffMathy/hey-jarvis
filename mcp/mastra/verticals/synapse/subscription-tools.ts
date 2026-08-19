import { z } from 'zod';
import { getSubscriptionStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { embedTexts } from '../../utils/static-embedder.js';
import { createTool } from '../../utils/tool-factory.js';
import {
  DEFAULT_MAXIMUM_MATCHES,
  DEFAULT_MINIMUM_SCORE,
  findRelevantSubscriptions as findRelevantSubscriptionsForDescription,
} from './subscription-matcher.js';

const subscriptionSchema = z.object({
  id: z.string(),
  source: z.string(),
  whenEvent: z.string(),
  givenCondition: z.string().optional(),
  thenAction: z.string(),
  oneShot: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
  triggerCount: z.number(),
  maxTriggerCount: z.number().nullable(),
  expiresAt: z.string().nullable(),
});

/**
 * Registers a Given/When/Then subscription — a "point of interest" the user has
 * expressed.
 *
 * All three components are embedded with Model2Vec (potion) at registration
 * time. The `whenEvent` and `givenCondition` embeddings are what incoming state changes are
 * matched against; the `thenAction` is embedded too so the action text can be searched
 * and deduplicated later.
 */
export const registerSubscription = createTool({
  id: 'registerSubscription',
  description:
    'Registers a subscription (a point of interest) using a Given/When/Then structure. Use this whenever the user shows interest in something or asks for something to happen when something else happens. The WHEN is the triggering event, the GIVEN is an optional precondition, and the THEN is the action. Example: "When the sun goes down, if the lights are on, close the blinds." You MUST give it an end: either maxTriggerCount (how many firings) or expiresAt (a date), or both. Nothing watches forever, and a subscription with no end quietly accumulates for the rest of the system\'s life.',
  inputSchema: z.object({
    whenEvent: z
      .string()
      .describe(
        'The triggering event, phrased as a short natural-language clause without the "when" keyword (e.g. "the sun goes down", "I get home from work")',
      ),
    givenCondition: z
      .string()
      .optional()
      .describe(
        'Optional precondition that must hold for the action to apply (e.g. "the lights are on"). Omit when the user did not state one.',
      ),
    thenAction: z
      .string()
      .describe('The action to take when the subscription fires (e.g. "close the blinds", "turn on the lights")'),
    source: z
      .string()
      .default('user')
      .describe('The agent/vertical registering this subscription (defaults to "user")'),
    oneShot: z
      .boolean()
      .default(false)
      .describe(
        'True when the subscription should only ever fire once, e.g. "the NEXT time I get home from work". Shorthand for maxTriggerCount: 1. Defaults to false (recurring).',
      ),
    maxTriggerCount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'How many times this may fire before it is deleted. Use when the request has a natural count: "remind me for the next three deliveries" is 3. Omit for something open-ended like "whenever the doorbell rings", and give expiresAt instead.',
      ),
    expiresAt: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp after which this is deleted, e.g. "2026-09-01T00:00:00.000Z". Use for anything tied to a date ("until I get back from holiday on the 8th") and as the catch-all for open-ended requests, where a generous horizon such as six months is better than none.',
      ),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    subscription: subscriptionSchema,
  }),
  execute: async (inputData) => {
    // Every subscription has to say how it ends. Enforced here rather than only in the
    // schema description, because the cost of forgetting is invisible and cumulative:
    // an endless subscription is scored against every state change forever, and nothing
    // ever removes it. Throwing gives the model a specific thing to fix and retry.
    const oneShot = inputData.oneShot ?? false;
    const maxTriggerCount = inputData.maxTriggerCount ?? (oneShot ? 1 : null);

    if (maxTriggerCount === null && !inputData.expiresAt) {
      throw new Error(
        'A subscription needs an end: pass maxTriggerCount (how many times it may fire), expiresAt (an ISO timestamp), or both. For an open-ended request, pick a generous expiresAt such as six months out rather than leaving it unbounded.',
      );
    }

    logger.info('Registering subscription', {
      whenEvent: inputData.whenEvent,
      givenCondition: inputData.givenCondition,
      thenAction: inputData.thenAction,
      maxTriggerCount,
      expiresAt: inputData.expiresAt ?? null,
    });

    const [whenEmbedding, thenEmbedding, givenEmbedding] = await embedTexts([
      inputData.whenEvent,
      inputData.thenAction,
      ...(inputData.givenCondition ? [inputData.givenCondition] : []),
    ]);

    if (!whenEmbedding || !thenEmbedding) {
      throw new Error('Failed to embed the subscription components');
    }

    const storage = await getSubscriptionStorage();
    const subscription = await storage.add(
      {
        source: inputData.source,
        whenEvent: inputData.whenEvent,
        givenCondition: inputData.givenCondition,
        thenAction: inputData.thenAction,
        oneShot,
        maxTriggerCount,
        expiresAt: inputData.expiresAt ?? null,
      },
      {
        whenEvent: whenEmbedding,
        thenAction: thenEmbedding,
        givenCondition: givenEmbedding ?? null,
      },
    );

    return { registered: true, subscription };
  },
});

/**
 * Lists the subscriptions currently registered.
 */
export const listSubscriptions = createTool({
  id: 'listSubscriptions',
  description:
    'Lists all registered subscriptions (points of interest) with their Given/When/Then components. Use this to show the user what Jarvis is currently watching for.',
  inputSchema: z.object({
    includeDisabled: z
      .boolean()
      .default(false)
      .describe('Include subscriptions that have been disabled (e.g. spent one-shot subscriptions)'),
  }),
  outputSchema: z.object({
    subscriptions: z.array(subscriptionSchema),
    count: z.number(),
  }),
  execute: async (inputData) => {
    const storage = await getSubscriptionStorage();
    const subscriptions = await storage.list({ includeDisabled: inputData.includeDisabled });

    return { subscriptions, count: subscriptions.length };
  },
});

/**
 * Scores a free-text description against every subscription's `whenEvent` and `givenCondition`
 * components and returns the strongest matches.
 */
export const findRelevantSubscriptions = createTool({
  id: 'findRelevantSubscriptions',
  description:
    'Finds the subscriptions most relevant to a described event, by semantic similarity against their WHEN and GIVEN parts. Returns candidates only — you still have to decide whether each one genuinely fires.',
  inputSchema: z.object({
    description: z
      .string()
      .describe('Natural-language description of what happened (e.g. "the sun just set and it is getting dark")'),
    minimumScore: z
      .number()
      .default(DEFAULT_MINIMUM_SCORE)
      .describe('Similarity floor between 0 and 1. Lower values return more (and looser) candidates.'),
    maximumMatches: z.number().default(DEFAULT_MAXIMUM_MATCHES).describe('Maximum number of candidates to return'),
  }),
  outputSchema: z.object({
    matches: z.array(
      z.object({
        subscription: subscriptionSchema,
        whenScore: z.number(),
        givenScore: z.number().nullable(),
        score: z.number(),
      }),
    ),
    count: z.number(),
  }),
  execute: async (inputData) => {
    const matches = await findRelevantSubscriptionsForDescription(inputData.description, {
      minimumScore: inputData.minimumScore,
      maximumMatches: inputData.maximumMatches,
    });

    return { matches, count: matches.length };
  },
});

/**
 * Records that a subscription fired, disabling it when it was one-shot.
 */
export const markSubscriptionTriggered = createTool({
  id: 'markSubscriptionTriggered',
  description:
    'Records that a subscription fired and its THEN action was carried out. One-shot subscriptions are disabled automatically so they never fire twice. Call this after acting on a subscription, not before.',
  inputSchema: z.object({
    subscriptionId: z.string().describe('The id of the subscription that fired'),
  }),
  outputSchema: z.object({
    triggered: z.boolean(),
    stillEnabled: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const storage = await getSubscriptionStorage();
    const subscription = await storage.markTriggered(inputData.subscriptionId);

    if (!subscription) {
      return {
        triggered: false,
        stillEnabled: false,
        message: `No subscription found with id ${inputData.subscriptionId}`,
      };
    }

    logger.info('Subscription triggered', {
      subscriptionId: subscription.id,
      triggerCount: subscription.triggerCount,
      stillEnabled: subscription.enabled,
    });

    return {
      triggered: true,
      stillEnabled: subscription.enabled,
      message: subscription.enabled
        ? `Subscription ${subscription.id} triggered (${subscription.triggerCount}x) and remains active`
        : `Subscription ${subscription.id} triggered and was disabled because it was one-shot`,
    };
  },
});

/**
 * Permanently deletes a subscription.
 */
export const removeSubscription = createTool({
  id: 'removeSubscription',
  description:
    'Permanently deletes a subscription. Use this when the user no longer wants Jarvis to watch for something. To keep the subscription but stop it firing, use setSubscriptionEnabled instead.',
  inputSchema: z.object({
    subscriptionId: z.string().describe('The id of the subscription to delete'),
  }),
  outputSchema: z.object({
    removed: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const storage = await getSubscriptionStorage();
    const removed = await storage.remove(inputData.subscriptionId);

    return {
      removed,
      message: removed
        ? `Subscription ${inputData.subscriptionId} removed`
        : `No subscription found with id ${inputData.subscriptionId}`,
    };
  },
});

/**
 * Enables or disables a subscription without deleting it.
 */
export const setSubscriptionEnabled = createTool({
  id: 'setSubscriptionEnabled',
  description:
    'Enables or disables a subscription without deleting it. Use this to pause a subscription temporarily, or to re-arm a spent one-shot subscription.',
  inputSchema: z.object({
    subscriptionId: z.string().describe('The id of the subscription to update'),
    enabled: z.boolean().describe('True to arm the subscription, false to pause it'),
  }),
  outputSchema: z.object({
    updated: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const storage = await getSubscriptionStorage();
    const updated = await storage.setEnabled(inputData.subscriptionId, inputData.enabled);

    return {
      updated,
      message: updated
        ? `Subscription ${inputData.subscriptionId} is now ${inputData.enabled ? 'enabled' : 'disabled'}`
        : `No subscription found with id ${inputData.subscriptionId}`,
    };
  },
});

/**
 * Deletes the subscriptions that can no longer fire.
 */
export const pruneExpiredSubscriptions = createTool({
  id: 'pruneExpiredSubscriptions',
  description:
    'Deletes subscriptions that have run out of firings or passed their expiry date. They are already ignored when matching, so this is housekeeping rather than something the user is waiting on. Use it when asked to tidy up, or to report what has lapsed.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    removed: z.array(subscriptionSchema),
    count: z.number(),
    message: z.string(),
  }),
  execute: async () => {
    const storage = await getSubscriptionStorage();
    const removed = await storage.pruneExpired();

    if (removed.length > 0) {
      logger.info('Pruned expired subscriptions', {
        count: removed.length,
        ids: removed.map((subscription) => subscription.id),
      });
    }

    return {
      removed,
      count: removed.length,
      message:
        removed.length === 0
          ? 'No subscriptions had lapsed'
          : `Removed ${removed.length} lapsed subscription${removed.length === 1 ? '' : 's'}`,
    };
  },
});

export const subscriptionTools = {
  registerSubscription,
  listSubscriptions,
  findRelevantSubscriptions,
  markSubscriptionTriggered,
  removeSubscription,
  setSubscriptionEnabled,
  pruneExpiredSubscriptions,
};
