/**
 * Visualize tests.
 *
 * Building a page takes a Claude Code session and pushing it takes a phone, so what is covered
 * here is the part in between that is this vertical's own: the brief a session is given, and the
 * reading of the page it hands back.
 */

import { describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { buildArtifactTask, findArtifactHtml, openArtifactOnPhone } from './shortcuts.js';

describe('buildArtifactTask', () => {
  const task = buildArtifactTask('  Visualize the electricity prices for the next 24 hours: 1.2, 0.9, 2.4 DKK  ');

  it('carries the request, trimmed', () => {
    expect(task).toContain('\nVisualize the electricity prices for the next 24 hours: 1.2, 0.9, 2.4 DKK\n');
  });

  it('asks for the page itself at the end, not a link to it', () => {
    expect(task).toContain('in a single ```html code block, with nothing after it');
    expect(task).toContain('do not make up a link to it');
  });

  it('keeps the session away from repositories and questions', () => {
    expect(task).toContain('do not modify any repository');
    expect(task).toContain('do not ask any');
  });

  it('designs for the phone the page is opened on', () => {
    expect(task).toContain('phone width');
  });
});

describe('buildArtifactTask for a glance', () => {
  const actions = [
    { id: 'unlock-front-door', label: 'Unlock the door', prompt: 'Unlock the front door' },
    { id: 'open-garage', label: 'Open the garage', prompt: 'Open the garage door' },
  ];
  const task = buildArtifactTask('The parcel from Zalando arrives between 14:00 and 16:00.', { glance: { actions } });

  it('designs a dark page held in the hand, opened from the launcher, not a notification', () => {
    expect(task).toContain('opens Jarvis from the launcher');
    expect(task).toContain('#05080c');
    expect(task).toContain('#38e1ff');
    expect(task).toContain('It is not a notification');
    expect(task).not.toContain('tapping a push notification');
  });

  it('wires every planned action through the bridge, by exactly its id', () => {
    expect(task).toContain("window.jarvis.act('<id>')");
    expect(task).toContain("window.addEventListener('jarvisactionresult'");
    expect(task).toContain('`unlock-front-door` — "Unlock the door": Unlock the front door');
    expect(task).toContain('`open-garage` — "Open the garage": Open the garage door');
  });

  it('forbids carrying out an action any other way', () => {
    expect(task).toContain('no fetch or other request to Home Assistant');
    expect(task).toContain('never define, replace or stub it');
  });

  it('asks for no buttons when there is nothing to do', () => {
    const calm = buildArtifactTask('Nothing needs you right now.', { glance: { actions: [] } });

    expect(calm).toContain('This glance has no actions');
    expect(calm).not.toContain("window.jarvis.act('<id>')");
  });
});

describe('findArtifactHtml', () => {
  const PAGE = '<!doctype html>\n<html><body><h1>Prices</h1></body></html>';

  it('reads the page out of a fenced block at the end', () => {
    expect(findArtifactHtml(`Here is the page.\n\n\`\`\`html\n${PAGE}\n\`\`\``)).toBe(PAGE);
  });

  it('takes the last block when the session showed a snippet first', () => {
    const message = `I styled it like this:\n\`\`\`html\n<div class="bar"></div>\n\`\`\`\nThe page:\n\`\`\`html\n${PAGE}\n\`\`\``;

    expect(findArtifactHtml(message)).toBe(PAGE);
  });

  it('finds a whole document that was not fenced', () => {
    expect(findArtifactHtml(`Done.\n${PAGE}`)).toBe(PAGE);
  });

  it('refuses a page that was cut off before it closed', () => {
    expect(findArtifactHtml('```html\n<!doctype html><html><body><h1>Pri\n```')).toBeUndefined();
  });

  it('finds nothing when the session handed back no page', () => {
    expect(findArtifactHtml('It is published at https://artifacts.local/news-summary')).toBeUndefined();
    expect(findArtifactHtml('')).toBeUndefined();
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
