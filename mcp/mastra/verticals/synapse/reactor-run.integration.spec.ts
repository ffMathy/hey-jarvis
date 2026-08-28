import { describe, expect, it } from 'bun:test';
import { getStateChangeReactorAgent } from './agent.js';
import { runStateChangeReactor } from './reactor-run.js';

/**
 * The one part of the synapse vertical that leaves the process: handing a state change to
 * the State Change Reactor, which is a real model call.
 *
 * This replaces a test of `flushStateChanges`. Flushing was how a batch reached the
 * reactor back when the vertical kept its own in-memory queue; batching is Mastra's
 * notification pipeline now, so the queue is gone and the flush with it. What the old
 * test was really covering — that the reactor runs, and comes back with something —
 * is covered here directly, without the queue in the way.
 */
describe('the state change reactor', () => {
  it('runs a state change through a real model and answers', async () => {
    const reactorAgent = await getStateChangeReactorAgent();

    const reasoning = await runStateChangeReactor(
      reactorAgent,
      `A state change has been detected:

Source: synapse-reactor-spec
Type: device_state_changed
Data: {"entityId":"light.kitchen","state":"off","previousState":"on"}

No subscriptions matched this state change.

Decide whether the user needs to know about this. A light being switched off is routine, so the expected answer is that no notification is warranted. Say what you decided.`,
    );

    expect(typeof reasoning).toBe('string');
    expect(reasoning.trim().length).toBeGreaterThan(0);

    console.log('✅ Reactor answered');
    console.log('   -', reasoning.slice(0, 200));
  }, 90000);
});
