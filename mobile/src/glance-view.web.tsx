import { useEffect, useImperativeHandle, useRef } from 'react';
import { bridgeActionOf } from './glance-bridge';
import type { GlanceViewProps } from './platform-contracts';
import { theme } from './theme';

/**
 * A glance's page in a browser: an `<iframe>`, which react-native-web draws as it is.
 *
 * - **Its page talks to this one only by `postMessage`**, and a message counts only from that very
 *   frame and its glance's origin: the window it came from and the origin the browser vouches for.
 *   The answer goes back the same way, addressed to that origin alone.
 * - **Sandboxed.** Scripts and forms run, on the page's own origin (which is the server's, never
 *   this app's, so it cannot reach this page's storage); a link that opens a new window opens a
 *   real tab; it may never navigate the app itself away.
 *
 * Where the page goes inside its frame a browser keeps to itself, so unlike a phone's WebView a link
 * followed in the frame is not checked here: the sandbox keeps whatever it reaches inside the frame.
 */
export function GlanceView({ url, origin, title, onAction, ref }: GlanceViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const action = useRef(onAction);
  action.current = onAction;

  useImperativeHandle(
    ref,
    () => ({
      deliverResult: (result) => frame.current?.contentWindow?.postMessage(result, origin),
    }),
    [origin],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const asked = bridgeActionOf(event.data);
      if (asked) action.current(asked.actionId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  return (
    <iframe
      ref={frame}
      src={url}
      title={title}
      data-testid="glance-page"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ flex: 1, width: '100%', height: '100%', border: 'none', backgroundColor: theme.colors.background }}
    />
  );
}
