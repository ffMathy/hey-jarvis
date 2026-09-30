/**
 * `generateUserInterface` tests.
 *
 * The two shortcuts it chains reach a Claude Code session and a phone, so both are replaced for
 * each test with `spyOn` — scoped to the test, unlike `mock.module`, which would replace the
 * coding and notification verticals for every test file sharing the process. What is left is the
 * tool's own decisions: when there is a page, whether to push it, and what a failed push costs.
 * The page is hosted for real, in a directory of the test's own under a made-up public hostname.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isSlowTask } from '../../utils/slow-tasks.js';
import { executeTool } from '../../utils/tool-factory.js';
import { readArtifact } from './artifact-hosting.js';
import { createArtifact, openArtifactOnPhone } from './shortcuts.js';
import { generateUserInterface } from './tools.js';

const PUBLIC_BASE_URL = 'https://jarvis.example.com';
const PAGE = '<!doctype html><html><body><h1>Electricity prices</h1></body></html>';
const SESSION_ANSWER = `The chart is ready.\n\n\`\`\`html\n${PAGE}\n\`\`\``;
const HOSTED_URL_PATTERN = /^https:\/\/jarvis\.example\.com\/artifacts\/([0-9a-f-]{36})$/;

const originalEnvironment = {
  storagePath: process.env.HEY_JARVIS_STORAGE_PATH,
  tunnelUrl: process.env.HEY_JARVIS_PUBLIC_URL,
};

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

let storageDirectory: string;

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
    stop_reason: 'end_turn',
    final_message: finalMessage,
    message: 'Claude Code session sesn_1 stopped with "end_turn".',
  });
}

beforeEach(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'visualize-tools-'));
  process.env.HEY_JARVIS_STORAGE_PATH = storageDirectory;
  process.env.HEY_JARVIS_PUBLIC_URL = PUBLIC_BASE_URL;
  ({ createArtifactSpy, openArtifactOnPhoneSpy } = spyOnShortcuts());
  openArtifactOnPhoneSpy.mockResolvedValue({ success: true, message: 'sent', serviceCalled: 'notify.mobile_app_x' });
});

afterEach(async () => {
  createArtifactSpy.mockRestore();
  openArtifactOnPhoneSpy.mockRestore();
  restoreEnvironmentVariable('HEY_JARVIS_STORAGE_PATH', originalEnvironment.storagePath);
  restoreEnvironmentVariable('HEY_JARVIS_PUBLIC_URL', originalEnvironment.tunnelUrl);
  await rm(storageDirectory, { recursive: true, force: true });
});

describe('generateUserInterface', () => {
  it('is marked slow, so routing offers to send the page on instead of holding the call', () => {
    expect(isSlowTask(generateUserInterface.id)).toBe(true);
  });

  it('hosts the page, returns its link and pushes it to the phone', async () => {
    sessionReports(SESSION_ANSWER);

    const result = await executeTool(generateUserInterface, {
      request: 'Visualize the electricity prices for today',
      title: 'Electricity prices',
    });

    expect(result).toMatchObject({ success: true, sentToPhone: true });
    const [, id] = result.artifactUrl?.match(HOSTED_URL_PATTERN) ?? [];
    expect(id).toBeDefined();
    expect(await readArtifact(id)).toBe(PAGE);
    expect(result.expiresAt).toBeDefined();
    expect(createArtifactSpy.mock.calls[0][0]).toEqual({ task: 'Visualize the electricity prices for today' });
    expect(openArtifactOnPhoneSpy.mock.calls[0][0]).toMatchObject({
      title: 'Electricity prices',
      url: result.artifactUrl,
    });
  });

  it('names the notification itself when the caller gave no title', async () => {
    sessionReports(SESSION_ANSWER);

    await executeTool(generateUserInterface, { request: 'Generate a UI for the shopping list' });

    expect(openArtifactOnPhoneSpy.mock.calls[0][0]).toMatchObject({ title: 'Jarvis built something for you' });
  });

  it('keeps the link to itself when asked not to push it', async () => {
    sessionReports(SESSION_ANSWER);

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram', sendToPhone: false });

    expect(result).toMatchObject({ success: true, sentToPhone: false });
    expect(result.artifactUrl).toMatch(HOSTED_URL_PATTERN);
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });

  it('still returns the link when the push fails', async () => {
    sessionReports(SESSION_ANSWER);
    openArtifactOnPhoneSpy.mockRejectedValue(new Error('No companion app'));

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: true, sentToPhone: false });
    expect(result.artifactUrl).toMatch(HOSTED_URL_PATTERN);
    expect(result.message).toContain('No companion app');
  });

  it('fails without pushing anything when the session handed back no page', async () => {
    sessionReports('It is published at https://artifacts.local/news-summary');

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: false, sentToPhone: false });
    expect(result.artifactUrl).toBeUndefined();
    expect(result.message).toContain('https://artifacts.local/news-summary');
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });

  it('fails without pushing anything when there is no public address to host at', async () => {
    delete process.env.HEY_JARVIS_PUBLIC_URL;
    sessionReports(SESSION_ANSWER);

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: false, sentToPhone: false });
    expect(result.message).toContain('HEY_JARVIS_PUBLIC_URL is not set');
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });

  it('passes on why the session failed', async () => {
    createArtifactSpy.mockResolvedValue({
      success: false,
      message: 'Could not run the task in a Claude Code session: not configured',
    });

    const result = await executeTool(generateUserInterface, { request: 'Draw a diagram' });

    expect(result).toMatchObject({ success: false, sentToPhone: false });
    expect(result.message).toContain('not configured');
    expect(openArtifactOnPhoneSpy).not.toHaveBeenCalled();
  });
});
