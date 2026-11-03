import { type ServerLink, serverSignInUrl } from 'hologram';

/**
 * What the page says about the line to sir's Jarvis server, and how it offers signing in to it.
 *
 * **Why signing in happens in the browser.** A browser cannot set a header on a WebSocket, so the
 * headset cannot send the token the phone and the watch send. When Cloudflare Zero Trust is in front
 * of the server, the headset gets through on Access's own `CF_Authorization` cookie instead, which
 * Quest Browser holds once it has been through Access's login at the server's hostname. The link
 * opens the socket's own path (`/api/live`) in a new tab: Access shows its login there, sets the
 * cookie for the application that covers the socket, and sends the tab back to the path, where the
 * server has no page to show — the tab is done with once the login is. The line's own retries then
 * connect within its longest wait. A browser cannot tell a socket Access turned away from one that
 * never reached the server, so the link is offered whenever the line is not connected.
 */

/** The status line for a line that is, or is not, connected. */
export function serverStatusText(connected: boolean): string {
  return connected
    ? 'Connected to your Jarvis server: he lights up what he works on, and knows what you point at.'
    : 'Not connected to your Jarvis server yet, so nothing lights up and pointing is not heard.';
}

/** The parts of the page this fills in, by only what it writes on each, which the page's elements are. */
export interface ServerStatusElements {
  section: Pick<HTMLElement, 'hidden'>;
  status: { textContent: string | null };
  signIn: Pick<HTMLElement, 'hidden'>;
  signInLink: { href: string };
}

/** Where the page's line goes: the server's address, if any, and whether this headset is paired with it. */
export interface ServerStatusSource {
  address: string | undefined;
  /**
   * A paired headset's line goes through the server's own check of its token, not Access, so
   * signing in to Access would not connect it, and is never offered.
   */
  paired: boolean;
}

/**
 * Shows the server's section when there is an address, and keeps it told of the line: the status,
 * and, for a headset that is not paired, the way to sign in while it is not connected. Returns how
 * to stop.
 */
export function showServerStatus(
  elements: ServerStatusElements,
  { address, paired }: ServerStatusSource,
  line: Pick<ServerLink, 'onConnectionChange'>,
): () => void {
  if (address === undefined) {
    elements.section.hidden = true;
    return () => undefined;
  }
  elements.section.hidden = false;
  elements.signInLink.href = serverSignInUrl(address);
  return line.onConnectionChange((connected) => {
    elements.status.textContent = serverStatusText(connected);
    elements.signIn.hidden = connected || paired;
  });
}
