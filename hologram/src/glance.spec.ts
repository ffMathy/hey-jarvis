import { describe, expect, it } from 'bun:test';
import {
  GLANCE_ACTION_PROMPT_MAX_LENGTH,
  GLANCE_ACTIONS_MAX,
  GLANCE_ID_MAX_LENGTH,
  GLANCE_URL_MAX_LENGTH,
  glanceActionAnswerOf,
  glanceActionFrame,
  glanceActionNamed,
  glanceOf,
  glanceOrigin,
  UNREADABLE_RESULT_MESSAGE,
} from './glance';

const UNLOCK = { id: 'unlock-front-door', label: 'Unlock the front door', prompt: 'Unlock the front door.' };

const GLANCE = {
  id: 'glance-1',
  url: 'https://jarvis.example.com/artifacts/0b6f3c1e-8f5d-4a58-9a77-3c4e2f1d9b10',
  title: 'A parcel is coming today',
  generatedAt: '2026-11-01T07:30:00.000Z',
  actions: [UNLOCK],
};

describe('reading a glance', () => {
  it('takes one in the shape the server sends, trimmed', () => {
    expect(glanceOf({ ...GLANCE, title: '  A parcel is coming today  ' })).toEqual(GLANCE);
  });

  it('drops one missing any of its fields, or with one out of bounds', () => {
    for (const field of ['id', 'url', 'title', 'generatedAt', 'actions'] as const) {
      const { [field]: _left, ...without } = GLANCE;
      expect(glanceOf(without)).toBeUndefined();
    }
    expect(glanceOf({ ...GLANCE, id: '   ' })).toBeUndefined();
    expect(glanceOf({ ...GLANCE, id: 'x'.repeat(GLANCE_ID_MAX_LENGTH + 1) })).toBeUndefined();
    expect(
      glanceOf({ ...GLANCE, url: `https://jarvis.example.com/${'a'.repeat(GLANCE_URL_MAX_LENGTH)}` }),
    ).toBeUndefined();
    expect(glanceOf({ ...GLANCE, generatedAt: 'this morning' })).toBeUndefined();
    expect(glanceOf({ ...GLANCE, actions: 'unlock' })).toBeUndefined();
    expect(glanceOf('glance')).toBeUndefined();
    expect(glanceOf(null)).toBeUndefined();
  });

  it('drops a page at an address no glance may be at', () => {
    for (const url of [
      'http://jarvis.example.com/artifacts/1',
      'javascript:alert(1)',
      'file:///sdcard/glance.html',
      'data:text/html,<p>hi</p>',
      'https://sir@jarvis.example.com/artifacts/1',
      '/artifacts/1',
    ]) {
      expect(glanceOf({ ...GLANCE, url })).toBeUndefined();
    }
    expect(glanceOf({ ...GLANCE, url: 'http://localhost:4112/artifacts/1' })?.url).toBe(
      'http://localhost:4112/artifacts/1',
    );
  });

  it('keeps the usable actions, each id once and no more than the limit', () => {
    const actions = [
      UNLOCK,
      { ...UNLOCK, label: 'A second unlock' },
      { id: 'no-prompt', label: 'Nothing to run' },
      { id: 'long', label: 'Too much', prompt: 'x'.repeat(GLANCE_ACTION_PROMPT_MAX_LENGTH + 1) },
      42,
      ...Array.from({ length: GLANCE_ACTIONS_MAX + 3 }, (_, index) => ({
        id: `action-${index}`,
        label: `Action ${index}`,
        prompt: `Do thing ${index}.`,
      })),
    ];

    const read = glanceOf({ ...GLANCE, actions });

    expect(read?.actions).toHaveLength(GLANCE_ACTIONS_MAX);
    expect(read?.actions[0]).toEqual(UNLOCK);
    expect(read?.actions.map((action) => action.id)).not.toContain('no-prompt');
    expect(read?.actions.map((action) => action.id)).not.toContain('long');
  });

  it('takes a glance with nothing to do, to read', () => {
    expect(glanceOf({ ...GLANCE, actions: [] })?.actions).toEqual([]);
  });

  it('finds an action by the id the page names, and nothing for one it does not list', () => {
    const glance = glanceOf(GLANCE);
    if (!glance) throw new Error('The glance should read');

    expect(glanceActionNamed(glance, 'unlock-front-door')).toEqual(UNLOCK);
    expect(glanceActionNamed(glance, 'open-the-garage')).toBeUndefined();
  });
});

describe('the origin a glance is on', () => {
  it('is the scheme and host, in lower case, with the port when there is one', () => {
    expect(glanceOrigin('https://Jarvis.Example.com/artifacts/1?x=1#y')).toBe('https://jarvis.example.com');
    expect(glanceOrigin('https://jarvis.example.com:8443')).toBe('https://jarvis.example.com:8443');
    expect(glanceOrigin('http://127.0.0.1:4112/artifacts/1')).toBe('http://127.0.0.1:4112');
  });

  it('is nothing for an address that is not https, nor http on this computer', () => {
    expect(glanceOrigin('http://evil.example.com/')).toBeUndefined();
    expect(glanceOrigin('about:blank')).toBeUndefined();
    expect(glanceOrigin('intent://scan/#Intent;scheme=zxing;end')).toBeUndefined();
    expect(glanceOrigin('https://user:password@jarvis.example.com/')).toBeUndefined();
  });
});

describe('the answer to an action', () => {
  it('is read with the request it answers', () => {
    expect(
      glanceActionAnswerOf({ type: 'glanceActionResult', requestId: 'r1', ok: true, message: 'Unlocked.' }),
    ).toEqual({ requestId: 'r1', ok: true, message: 'Unlocked.' });
  });

  it('is dropped without a usable request id, a boolean ok or a text message', () => {
    expect(glanceActionAnswerOf({ requestId: '', ok: true, message: 'Unlocked.' })).toBeUndefined();
    expect(glanceActionAnswerOf({ requestId: 'x'.repeat(65), ok: true, message: 'Unlocked.' })).toBeUndefined();
    expect(glanceActionAnswerOf({ requestId: 'r1', ok: 'yes', message: 'Unlocked.' })).toBeUndefined();
    expect(glanceActionAnswerOf({ requestId: 'r1', ok: true, message: 7 })).toBeUndefined();
  });

  it('still answers its request when the message cannot be shown, in the device’s own words', () => {
    expect(glanceActionAnswerOf({ requestId: 'r1', ok: false, message: '  ' })).toEqual({
      requestId: 'r1',
      ok: false,
      message: UNREADABLE_RESULT_MESSAGE,
    });
  });
});

describe('the frame asking for an action', () => {
  it('names the request, the glance and the action, and nothing else', () => {
    expect(JSON.parse(glanceActionFrame('r1', 'glance-1', 'unlock-front-door'))).toEqual({
      type: 'glanceAction',
      requestId: 'r1',
      glanceId: 'glance-1',
      actionId: 'unlock-front-door',
    });
  });

  it('fits the server’s 1 KiB frame limit with every id at its longest', () => {
    const frame = glanceActionFrame('r'.repeat(64), 'g'.repeat(GLANCE_ID_MAX_LENGTH), 'a'.repeat(GLANCE_ID_MAX_LENGTH));
    expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(1024);
  });
});
