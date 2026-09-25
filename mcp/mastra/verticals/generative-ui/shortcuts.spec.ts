/**
 * Generative UI tests.
 *
 * Building a page takes a Claude cloud session and pushing it takes a phone, so what is covered
 * here is the part in between that is this vertical's own: the brief a session is given, and the
 * reading of the link it reports back.
 */

import { describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { buildArtifactTask, findArtifactUrl, openArtifactOnPhone } from './shortcuts.js';

describe('buildArtifactTask', () => {
  const task = buildArtifactTask('  Visualize the electricity prices for the next 24 hours: 1.2, 0.9, 2.4 DKK  ');

  it('carries the request, trimmed', () => {
    expect(task).toContain('\nVisualize the electricity prices for the next 24 hours: 1.2, 0.9, 2.4 DKK\n');
  });

  it('asks for a published artifact with its URL on the last line', () => {
    expect(task).toContain('artifact');
    expect(task).toContain("End your final message with the artifact's URL alone on its last line.");
  });

  it('keeps the session away from repositories and questions', () => {
    expect(task).toContain('do not modify any repository');
    expect(task).toContain('do not ask any');
  });

  it('designs for the phone the page is opened on', () => {
    expect(task).toContain('phone width');
  });
});

describe('findArtifactUrl', () => {
  it('reads a URL alone on the last line', () => {
    expect(findArtifactUrl('The chart is ready.\nhttps://claude.ai/artifact/abc123')).toBe(
      'https://claude.ai/artifact/abc123',
    );
  });

  it('takes the last URL when the session mentioned its sources first', () => {
    const message = 'Prices from https://www.energidataservice.dk/ were used.\nhttps://claude.ai/artifact/abc123';

    expect(findArtifactUrl(message)).toBe('https://claude.ai/artifact/abc123');
  });

  it('reads a URL out of a markdown link or angle brackets', () => {
    expect(findArtifactUrl('[Open the page](https://claude.ai/artifact/abc123)')).toBe(
      'https://claude.ai/artifact/abc123',
    );
    expect(findArtifactUrl('<https://claude.ai/artifact/abc123>')).toBe('https://claude.ai/artifact/abc123');
  });

  it('leaves the full stop that ends a sentence behind', () => {
    expect(findArtifactUrl('It is published at https://claude.ai/artifact/abc123.')).toBe(
      'https://claude.ai/artifact/abc123',
    );
  });

  it('keeps the query string', () => {
    expect(findArtifactUrl('https://example.com/page?id=7&view=chart')).toBe(
      'https://example.com/page?id=7&view=chart',
    );
  });

  it('finds nothing when the session reported no link', () => {
    expect(findArtifactUrl('I could not publish the page.')).toBeUndefined();
    expect(findArtifactUrl('')).toBeUndefined();
  });
});

describe('openArtifactOnPhone', () => {
  it('refuses to push a notification with nothing to open', async () => {
    // Refused before the notification vertical is reached, so nothing is sent.
    await expect(executeTool(openArtifactOnPhone, { message: 'Tap to open it.', title: 'Your chart' })).rejects.toThrow(
      /needs the artifact's url/,
    );
  });
});
