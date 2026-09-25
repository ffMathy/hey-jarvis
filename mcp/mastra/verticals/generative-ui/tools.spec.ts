/**
 * `generateUserInterface` tests.
 *
 * The two shortcuts it chains reach a Claude cloud session and a phone, so both are replaced for
 * each test with `spyOn` — scoped to the test, unlike `mock.module`, which would replace the
 * coding and notification verticals for every test file sharing the process. What is left is the
 * tool's own decisions: when there is a link, whether to push it, and what a failed push costs.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { createArtifact, openArtifactOnPhone } from './shortcuts.js';
import { generateUserInterface } from './tools.js';

const ARTIFACT_URL = 'https://claude.ai/artifact/abc123';
const SESSION_URL = 'https://platform.claude.com/sessions/sesn_1';

function spyOnShortcuts() {
  return {
    createArtifactSpy: spyOn(createArtifact, 'execute'),
    openArtifactOnPhoneSpy: spyOn(openArtifactOnPhone, 'execute'),
  };
}

let createArtifactSpy: ReturnType<typeof spyOnShortcuts>['createArtifactSpy'];
let openArtifactOnPhoneSpy: ReturnType<typeof spyOnShortcuts>['openArtifactOnPhoneSpy'];

function sessionReports(finalMessage: string, success = true) {
  createArtifactSpy.mockResolvedValue({
    success,
    session_id: 'sesn_1',
    session_url: SESSION_URL,
    stop_reason: 'end_turn',
    final_message: finalMessage,
    message: 'Claude cloud session sesn_1 stopped with "end_turn".',
  });
}

beforeEach(() => {
  ({ createArtifactSpy, openArtifactOnPhoneSpy } = spyOnShortcuts());
  openArtifactOnPhoneSpy.mockResolvedValue({ success: true, message: 'sent', serviceCalled: 'notify.mobile_app_x' });
});

afterEach(() => {
  createArtifactSpy.mockRestore();
  openArtifactOnPhoneSpy.mockRestore();
});

describe('generateUserInterface', () => {
  it('returns the published link and pushes it to the phone', async () => {
    sessionReports(`The chart is ready.\n${ARTIFACT_URL}`);

    const result = await executeTool(generateUserInterface, {
      request: 'Visualize the electricity prices for today',
      title: 'Electricity prices',
    });

    expect(result).toMatchObject({
      success: true,
      artifactUrl: ARTIFACT_URL,
      sessionUrl: SESSION_URL,
      sentToPhone: true,
    });
    expect(createArtifactSpy.mock.calls[0][0]).toEqual({ task: 'Visualize the electricity prices for today' });
    expect(openArtifactOnPhoneSpy.mock.calls[0][0]).toMatchObject({ title: 'Electricity prices', url: ARTIFACT_URL });
  });

  it('names the notification itself when the caller gave no title', async () => {
    sessionReports(ARTIFACT_URL);

    await executeTool(generateUserInterface, { request: 'Generate a UI for the shopping list' });

    expect(openArtifactOnPhoneSpy.mock.calls[0][0]).toMatchObject({ title: 'Jarvis built something for you' });
  });

  it('keeps the link to itself when asked not to push it', async () => {
    sessionReports(ARTIFACT_URL);

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram', sendToPhone: false });

    expect(result).toMatchObject({ success: true, artifactUrl: ARTIFACT_URL, sentToPhone: false });
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });

  it('still returns the link when the push fails', async () => {
    sessionReports(ARTIFACT_URL);
    openArtifactOnPhoneSpy.mockRejectedValue(new Error('No companion app'));

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: true, artifactUrl: ARTIFACT_URL, sentToPhone: false });
    expect(result.message).toContain('No companion app');
  });

  it('fails without pushing anything when the session reported no link', async () => {
    sessionReports('I could not publish the page.');

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: false, sentToPhone: false, sessionUrl: SESSION_URL });
    expect(result.artifactUrl).toBeUndefined();
    expect(result.message).toContain('I could not publish the page.');
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });

  it('passes on why the session failed', async () => {
    createArtifactSpy.mockResolvedValue({
      success: false,
      message: 'Could not run the task in a Claude cloud session: not configured',
    });

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: false, sentToPhone: false });
    expect(result.message).toContain('not configured');
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });
});
