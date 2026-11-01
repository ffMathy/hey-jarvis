/**
 * The bridge between a glance page and the app showing it.
 *
 * A glance (`glance.ts`) offers buttons — "Unlock the front door" — and the page cannot carry them
 * out itself: it is static HTML written by a Claude Code session, with no credential and no way to
 * reach Home Assistant, and it must stay that way. So a button only *names* its action, by the id
 * the server planned, and the app showing the page passes that name on to the server over its live
 * socket, which runs the action and answers. This script is how the page and the app talk:
 *
 * - `window.jarvis.act(actionId)` posts `{"type":"jarvisAction","actionId":"…"}`, as a string, to
 *   `window.ReactNativeWebView` when the page is in the phone's WebView, or else to the parent
 *   window when it is in an iframe (the web build). Opened anywhere else, nobody can act on it, and
 *   the page is told so at once as a failed result.
 * - The outcome comes back as a `jarvisactionresult` event on `window`, with
 *   `detail: { actionId, ok, message }`. The Android host dispatches that event itself, through
 *   `injectJavaScript`; a parent window posts `{"type":"jarvisActionResult",…}` instead, as a string
 *   or an object, and the bridge re-dispatches it as the same event.
 *
 * Injected by the server rather than written by the session, so every glance speaks exactly this
 * protocol, whatever the session made of its brief.
 */

/** What the page's buttons call, and what the page listens for. Named once, for the brief too. */
export const GLANCE_BRIDGE = {
  actFunction: 'window.jarvis.act',
  resultEvent: 'jarvisactionresult',
  actionMessageType: 'jarvisAction',
  resultMessageType: 'jarvisActionResult',
} as const;

/**
 * The bridge itself, as plain ES5 so it runs in any WebView. It defines `window.jarvis` and never
 * reads anything from the page.
 */
export const GLANCE_BRIDGE_SCRIPT = `(function () {
  function dispatchResult(actionId, ok, message) {
    window.dispatchEvent(new CustomEvent('${GLANCE_BRIDGE.resultEvent}', {
      detail: { actionId: actionId, ok: ok, message: message }
    }));
  }
  function post(message) {
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(message);
      return true;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*');
      return true;
    }
    return false;
  }
  window.jarvis = {
    act: function (actionId) {
      var id = String(actionId);
      if (!post(JSON.stringify({ type: '${GLANCE_BRIDGE.actionMessageType}', actionId: id }))) {
        Promise.resolve().then(function () {
          dispatchResult(id, false, 'Open this page in the Jarvis app to do that.');
        });
      }
    }
  };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (error) { return; }
    }
    if (!data || typeof data !== 'object' || data.type !== '${GLANCE_BRIDGE.resultMessageType}' || typeof data.actionId !== 'string') {
      return;
    }
    dispatchResult(data.actionId, data.ok === true, typeof data.message === 'string' ? data.message : '');
  });
})();`;

const HEAD_OPENING_TAG = /<head(?:\s[^>]*)?>/i;
const HTML_OPENING_TAG = /<html(?:\s[^>]*)?>/i;

/**
 * Puts the bridge into a page, first thing in its `<head>` — or right after `<html>` when it has no
 * head, or at the very start of a fragment — so it is defined before any script of the page's own
 * runs.
 */
export function injectGlanceBridge(html: string): string {
  const scriptTag = `<script>${GLANCE_BRIDGE_SCRIPT}</script>`;

  for (const openingTag of [HEAD_OPENING_TAG, HTML_OPENING_TAG]) {
    const match = openingTag.exec(html);
    if (match) {
      const insertAt = match.index + match[0].length;
      return `${html.slice(0, insertAt)}${scriptTag}${html.slice(insertAt)}`;
    }
  }

  return `${scriptTag}${html}`;
}
