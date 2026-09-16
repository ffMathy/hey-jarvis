import type { Mastra } from '@mastra/core';
import { logger } from '../../utils/logger.js';

/**
 * Keeping the number of routing plans in Studio bounded.
 *
 * A plan is a workflow built for one request, so every request adds entries to the workflow
 * list -- a root plus one branch workflow per agent it delegates to. Left alone that grows
 * without limit, and a list of five hundred plans is no more use than no list at all.
 *
 * Two facts shape what a sweep has to do. `removeWorkflow` clears only the live in-process
 * registration, so on its own it hides a plan until the next boot and no longer; the
 * persisted definition has to be dealt with separately or it rehydrates. And a definition
 * row carries a `status`, of which only `active` is loaded at startup -- so archiving is a
 * way to stop a plan coming back without throwing away what it recorded.
 *
 * So: unregister, then archive. The newest {@link PLANS_KEPT} plans stay visible and
 * runnable, older ones disappear from the list, and nothing is destroyed.
 */

/**
 * How many recent plans stay in Studio.
 *
 * Small on purpose. The list is for looking at what just happened, and a plan from two
 * hundred requests ago is not that -- the traces are where older history is read. Counted in
 * plans rather than workflows, because one plan is a root plus a branch per delegation and a
 * bound on entries would swing with how many agents a request happened to need.
 */
export const PLANS_KEPT = 5;

/** Marks a definition as a routing plan, so a sweep only ever touches its own rows. */
export interface RoutingPlanMetadata extends Record<string, unknown> {
  kind: 'routing-plan';
  /** Shared by every workflow in one plan, so a plan is swept whole rather than in pieces. */
  planId: string;
}

/** The metadata every workflow in a plan carries. */
export function routingPlanMetadata(planId: string): RoutingPlanMetadata {
  return { kind: 'routing-plan', planId };
}

/** Whether a stored definition is one of ours, and which plan it belongs to. */
function planIdOf(metadata: Record<string, unknown> | undefined): string | undefined {
  if (metadata?.kind !== 'routing-plan') {
    return undefined;
  }
  const planId = metadata.planId;
  return typeof planId === 'string' ? planId : undefined;
}

/**
 * Unregisters and archives every routing plan but the newest {@link PLANS_KEPT}.
 *
 * Ordered by the newest row in each plan, because a plan's members are written together and
 * any of them dates it. A plan is swept whole: leaving a branch behind would leave the list
 * holding workflows whose root is gone.
 *
 * Failure is logged rather than thrown. A sweep that cannot run leaves a longer list than
 * intended, which is untidy; a sweep that throws would fail the request that triggered it,
 * which is worse.
 */
export async function sweepOldRoutingPlans(mastra: Mastra, keep: number = PLANS_KEPT): Promise<void> {
  const definitions = await mastra.getStorage()?.getStore('workflowDefinitions');
  if (!definitions) {
    logger.warn('No workflow definition storage, so routing plans cannot be swept');
    return;
  }

  try {
    const { definitions: rows } = await definitions.list({ status: 'active' });

    const newestByPlan = new Map<string, number>();
    for (const row of rows) {
      const planId = planIdOf(row.metadata);
      if (!planId) {
        continue;
      }
      const at = row.createdAt.getTime();
      newestByPlan.set(planId, Math.max(newestByPlan.get(planId) ?? at, at));
    }

    const stale = new Set(
      [...newestByPlan.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(keep)
        .map(([planId]) => planId),
    );
    if (stale.size === 0) {
      return;
    }

    for (const row of rows) {
      const planId = planIdOf(row.metadata);
      if (!planId || !stale.has(planId)) {
        continue;
      }
      mastra.removeWorkflow(row.id);
      await definitions.upsert({ id: row.id, status: 'archived' });
    }

    logger.info('Swept routing plans out of the workflow list', { plans: stale.size, kept: keep });
  } catch (error) {
    logger.error('Could not sweep routing plans', { error });
  }
}
