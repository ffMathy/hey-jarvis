import { describe, expect, it } from 'bun:test';
import { glanceOf } from 'hologram';
import { type ActionConfirmation, CANCELLED_RESULT, runGlanceAction } from './glance-actions';
import type { BridgeResult } from './glance-bridge';

const glance = glanceOf({
  id: 'glance-1',
  url: 'https://jarvis.example.com/artifacts/1',
  title: 'A parcel is coming today',
  generatedAt: '2026-11-01T07:30:00.000Z',
  actions: [{ id: 'track', label: 'Track parcel', prompt: 'Unlock the front door for the courier.' }],
});
if (!glance) throw new Error('The glance should read');

/** One press, with sir answering `answer`, and the server answering `serverAnswer`. */
function press(actionId: string, answer: boolean, serverAnswer = { ok: true, message: 'Unlocked.' }) {
  const asked: ActionConfirmation[] = [];
  const sent: [string, string][] = [];
  const delivered: BridgeResult[] = [];
  const reported: unknown[] = [];
  if (!glance) throw new Error('The glance should read');
  const running = runGlanceAction({
    glance,
    actionId,
    confirm: async (confirmation) => {
      asked.push(confirmation);
      return answer;
    },
    request: async (glanceId, id) => {
      sent.push([glanceId, id]);
      return serverAnswer;
    },
    deliver: (result) => delivered.push(result),
    report: (result) => reported.push(result),
  });
  return { running, asked, sent, delivered, reported };
}

describe('a press on a glance’s page', () => {
  it('asks sir with the prompt the server will run, never the page’s label, before sending anything', async () => {
    const { running, asked, sent, delivered, reported } = press('track', true);

    expect(await running).toBe(true);
    expect(asked).toEqual([{ title: 'Ask Jarvis to do this?', prompt: 'Unlock the front door for the courier.' }]);
    expect(sent).toEqual([['glance-1', 'track']]);
    expect(delivered).toEqual([{ type: 'jarvisActionResult', actionId: 'track', ok: true, message: 'Unlocked.' }]);
    expect(reported).toEqual([{ ok: true, message: 'Unlocked.' }]);
  });

  it('sends nothing when sir says no, and tells the page it was cancelled', async () => {
    const { running, sent, delivered, reported } = press('track', false);

    expect(await running).toBe(true);
    expect(sent).toEqual([]);
    expect(delivered).toEqual([{ type: 'jarvisActionResult', actionId: 'track', ...CANCELLED_RESULT }]);
    expect(reported).toEqual([]);
  });

  it('ignores an action the glance does not list: nothing asked, sent or answered', async () => {
    const { running, asked, sent, delivered } = press('unlock-everything', true);

    expect(await running).toBe(false);
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it('passes on a failure the server answers with, to the page and to sir', async () => {
    const { running, delivered, reported } = press('track', true, { ok: false, message: 'The lock is offline.' });

    await running;
    expect(delivered[0]).toMatchObject({ ok: false, message: 'The lock is offline.' });
    expect(reported).toEqual([{ ok: false, message: 'The lock is offline.' }]);
  });
});
