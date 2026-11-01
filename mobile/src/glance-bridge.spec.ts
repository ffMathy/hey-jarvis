import { describe, expect, it } from 'bun:test';
import { bridgeActionOf, bridgeResult, navigationVerdict, resultDeliveryScript } from './glance-bridge';

const ORIGIN = 'https://jarvis.example.com';

describe('what the page asks for', () => {
  it('is an action, as the server’s bridge script posts it', () => {
    expect(bridgeActionOf(JSON.stringify({ type: 'jarvisAction', actionId: 'unlock-front-door' }))).toEqual({
      actionId: 'unlock-front-door',
    });
    expect(bridgeActionOf({ type: 'jarvisAction', actionId: ' unlock-front-door ' })).toEqual({
      actionId: 'unlock-front-door',
    });
  });

  it('is nothing for anything else the page posts', () => {
    for (const data of [
      'not json',
      '"jarvisAction"',
      JSON.stringify({ type: 'jarvisActionResult', actionId: 'x' }),
      JSON.stringify({ type: 'jarvisAction' }),
      JSON.stringify({ type: 'jarvisAction', actionId: 7 }),
      JSON.stringify({ type: 'jarvisAction', actionId: '   ' }),
      JSON.stringify({ type: 'jarvisAction', actionId: 'x'.repeat(201) }),
      JSON.stringify([{ type: 'jarvisAction', actionId: 'x' }]),
      null,
      42,
    ]) {
      expect(bridgeActionOf(data)).toBeUndefined();
    }
  });
});

describe('telling the page how it went', () => {
  it('names the action, and says whether it was done and what came of it', () => {
    expect(bridgeResult('unlock-front-door', { ok: true, message: 'Unlocked.' })).toEqual({
      type: 'jarvisActionResult',
      actionId: 'unlock-front-door',
      ok: true,
      message: 'Unlocked.',
    });
  });

  it('dispatches the bridge’s event on a phone, with nothing in a message able to break out of it', () => {
    const result = bridgeResult('unlock', { ok: false, message: `"); alert('x'); (" </script>` });
    const dispatched: { type: string; detail: unknown }[] = [];
    const window = { dispatchEvent: (event: { type: string; detail: unknown }) => dispatched.push(event) };
    class CustomEvent {
      readonly detail: unknown;
      constructor(
        readonly type: string,
        init: { detail: unknown },
      ) {
        this.detail = init.detail;
      }
    }

    const ended = new Function(
      'window',
      'CustomEvent',
      `return ${resultDeliveryScript(result).replace(/ true;$/, '')}`,
    )(window, CustomEvent);

    expect(ended).toBe(1);
    expect(dispatched).toEqual([
      { type: 'jarvisactionresult', detail: { actionId: 'unlock', ok: false, message: result.message } },
    ]);
    expect(resultDeliveryScript(result).endsWith('true;')).toBe(true);
  });
});

describe('where the page may go', () => {
  it('loads its own origin, exactly', () => {
    expect(navigationVerdict('https://jarvis.example.com/artifacts/2', ORIGIN)).toBe('load');
    expect(navigationVerdict('https://JARVIS.example.com/artifacts/2#top', ORIGIN)).toBe('load');
  });

  it('sends another web page to the browser, a look-alike host included', () => {
    expect(navigationVerdict('https://tracking.example-carrier.com/parcel/1', ORIGIN)).toBe('open-outside');
    expect(navigationVerdict('https://jarvis.example.com.evil.example/', ORIGIN)).toBe('open-outside');
    expect(navigationVerdict('https://jarvis.example.com:8443/', ORIGIN)).toBe('open-outside');
  });

  it('blocks everything that is not a web page', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///data/data/com.ffmathy.heyjarvis/',
      'intent://scan/#Intent;scheme=zxing;end',
      'tel:+4512345678',
      'heyjarvis://assist',
      'about:blank',
      'http://evil.example.com/',
    ]) {
      expect(navigationVerdict(url, ORIGIN)).toBe('block');
    }
  });
});
