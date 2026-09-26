/**
 * The coding agent as routing hands it a request.
 *
 * Building the agent neither contacts the model provider nor needs an API key, so these pin down
 * its configuration only.
 */

import { describe, expect, it } from 'bun:test';
import { LOW_THINKING_PROVIDER_OPTIONS } from '../../utils/index.js';
import { getCodingAgent } from './agent.js';

describe('getCodingAgent', () => {
  it('thinks at low, since it only chooses a tool -- the codebase is read in a cloud session', async () => {
    const agent = await getCodingAgent();

    expect(await agent.getDefaultOptions()).toMatchObject({ providerOptions: LOW_THINKING_PROVIDER_OPTIONS });
  });

  it('is told to call the tool that answers straight away, without looking the repository up', async () => {
    const instructions = await (await getCodingAgent()).getInstructions();

    expect(instructions).toContain('never list or search repositories just to confirm it');
  });
});
