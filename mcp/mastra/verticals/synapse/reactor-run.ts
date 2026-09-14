import type { Agent } from '@mastra/core/agent';
import { logger } from '../../utils/logger.js';

/**
 * How many supervisor iterations the reactor may take before it is cut off.
 *
 * `.network()` capped its own routing loop internally, so nothing here had to say what
 * the limit was. A supervisor agent has no implicit cap, so the number has to be stated
 * somewhere — and this is the only place both callers go through.
 *
 * Ten is generous for the work this agent actually does: confirm a handful of candidate
 * subscriptions, carry out the THEN of the ones that fire, and possibly delegate a single
 * notification. It is also low enough to stop a local Qwen3 that has started talking to
 * itself, which is the failure this cap is really for.
 */
const REACTOR_MAX_STEPS = 10;

/**
 * Runs the State Change Reactor as a supervisor agent and waits for it to finish.
 *
 * Both callers — the per-change workflow and the batcher — want the same thing: hand the
 * reactor a prompt, let it delegate to the Notification agent as it sees fit, and block
 * until it is done. Neither reads the output incrementally, which is why this is
 * `generate()` and not `stream()`.
 *
 * This lives outside `agent.ts` on purpose. The batcher specs replace that whole module
 * to supply a fake reactor, and `mock.module` swaps the module rather than merging with
 * it, so any helper exported alongside `getStateChangeReactorAgent` would vanish for
 * those tests. Keeping the run here leaves `getStateChangeReactorAgent` as the single
 * seam the specs have to know about.
 *
 * @returns The reactor's closing text. Empty means it finished without saying anything,
 * which the callers report as "not analyzed" rather than treating as success.
 */
export async function runStateChangeReactor(reactorAgent: Agent, prompt: string): Promise<string> {
  const result = await reactorAgent.generate(prompt, {
    maxSteps: REACTOR_MAX_STEPS,
    delegation: {
      onDelegationComplete: (context) => {
        // A delegation that threw, or that came back with nothing to say, reaches the
        // supervisor as a tool result with empty text — which reads as "asked, answered"
        // and lets the reactor carry on as though the notification went out. `resultText`
        // replaces what the parent model sees for this call within the current run, so
        // the failure lands where the next decision is made instead of only in our logs.
        if (context.error) {
          logger.warn('State change reactor delegation failed', {
            primitiveId: context.primitiveId,
            error: context.error.message,
          });
          return {
            resultText: `Delegation to ${context.primitiveId} failed: ${context.error.message}. It did not happen.`,
          };
        }

        if (context.result.text.trim() === '') {
          return {
            resultText: `${context.primitiveId} returned nothing. Assume the action did not happen.`,
          };
        }
      },
    },
  });

  return result.text;
}
