/**
 * The glance bridge, run for real: the script is taken out of an injected page and executed against
 * a small stand-in for a browser window — an `EventTarget` with the WebView's `postMessage`, or a
 * parent frame — so what is checked is the code the phone runs, not a description of it.
 */

import { describe, expect, it } from 'bun:test';
import { GLANCE_BRIDGE_SCRIPT, injectGlanceBridge } from './glance-bridge.js';

const PAGE = '<!doctype html><html lang="en"><head><title>Glance</title></head><body></body></html>';

interface FakeWindow extends EventTarget {
  jarvis?: { act(actionId: string): void };
  parent?: FakeWindow | { postMessage(message: string, targetOrigin: string): void };
  ReactNativeWebView?: { postMessage(message: string): void };
}

/** Runs the bridge in `fakeWindow`, as a page would on load. */
function runBridge(fakeWindow: FakeWindow, script = GLANCE_BRIDGE_SCRIPT): FakeWindow {
  new Function('window', script)(fakeWindow);
  return fakeWindow;
}

/** The detail of every `jarvisactionresult` event the page would see. */
function resultsOf(fakeWindow: FakeWindow): unknown[] {
  const results: unknown[] = [];
  fakeWindow.addEventListener('jarvisactionresult', (event) => {
    if (event instanceof CustomEvent) {
      results.push(event.detail);
    }
  });
  return results;
}

/** A window inside the phone's WebView. */
function webViewWindow(): { fakeWindow: FakeWindow; posted: string[] } {
  const posted: string[] = [];
  const fakeWindow: FakeWindow = Object.assign(new EventTarget(), {
    ReactNativeWebView: { postMessage: (message: string) => posted.push(message) },
  });
  fakeWindow.parent = fakeWindow;
  return { fakeWindow: runBridge(fakeWindow), posted };
}

describe('injectGlanceBridge', () => {
  it('puts the bridge first in the head, before any script of the page', () => {
    const injected = injectGlanceBridge(PAGE);

    expect(injected.startsWith('<!doctype html><html lang="en"><head><script>(function () {')).toBe(true);
    expect(injected.endsWith('</script><title>Glance</title></head><body></body></html>')).toBe(true);
  });

  it('puts it right after <html> in a page with no head, and first in a fragment', () => {
    expect(injectGlanceBridge('<html><body>Hi</body></html>')).toStartWith('<html><script>');
    expect(injectGlanceBridge('<header>Hi</header>')).toStartWith('<script>');
  });

  it('injects the very script that defines window.jarvis', () => {
    const script = injectGlanceBridge(PAGE).match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const fakeWindow = runBridge(new EventTarget(), script);

    expect(typeof fakeWindow.jarvis?.act).toBe('function');
  });
});

describe('the bridge', () => {
  it("posts an action to the phone's WebView as a string", () => {
    const { fakeWindow, posted } = webViewWindow();

    fakeWindow.jarvis?.act('unlock-front-door');

    expect(posted).toEqual([JSON.stringify({ type: 'jarvisAction', actionId: 'unlock-front-door' })]);
  });

  it('posts an action to the parent window when the page is in an iframe', () => {
    const posted: Array<{ message: string; targetOrigin: string }> = [];
    const fakeWindow: FakeWindow = new EventTarget();
    fakeWindow.parent = { postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }) };
    runBridge(fakeWindow);

    fakeWindow.jarvis?.act('open-garage');

    expect(posted).toEqual([
      { message: JSON.stringify({ type: 'jarvisAction', actionId: 'open-garage' }), targetOrigin: '*' },
    ]);
  });

  it('tells the page at once that nobody can act on it, when it is open on its own', async () => {
    const fakeWindow: FakeWindow = new EventTarget();
    fakeWindow.parent = fakeWindow;
    runBridge(fakeWindow);
    const results = resultsOf(fakeWindow);

    fakeWindow.jarvis?.act('open-garage');
    await Promise.resolve();

    expect(results).toEqual([
      { actionId: 'open-garage', ok: false, message: 'Open this page in the Jarvis app to do that.' },
    ]);
  });

  it('re-dispatches a posted result, as a string or an object, as a jarvisactionresult event', () => {
    const { fakeWindow } = webViewWindow();
    const results = resultsOf(fakeWindow);

    fakeWindow.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'jarvisActionResult', actionId: 'unlock-front-door', ok: true, message: 'Done.' }),
      }),
    );
    fakeWindow.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'jarvisActionResult', actionId: 'open-garage', ok: false, message: 'It is jammed.' },
      }),
    );

    expect(results).toEqual([
      { actionId: 'unlock-front-door', ok: true, message: 'Done.' },
      { actionId: 'open-garage', ok: false, message: 'It is jammed.' },
    ]);
  });

  it('ignores every other message', () => {
    const { fakeWindow } = webViewWindow();
    const results = resultsOf(fakeWindow);

    for (const data of ['not json', '{"type":"somethingElse"}', { type: 'jarvisActionResult' }, null, 42]) {
      fakeWindow.dispatchEvent(new MessageEvent('message', { data }));
    }

    expect(results).toEqual([]);
  });
});
