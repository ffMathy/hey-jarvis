import type { ServerLink } from 'hologram';

/**
 * What the page says about the line to sir's Jarvis server.
 *
 * Only a paired headset has a line: the server lets no socket in but a paired device's, whose token
 * it checks itself, so there is no Access sign-in to offer here. Pairing is where signing in happens,
 * once (`paired-device.ts` in `hologram`).
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
}

/**
 * Shows the server's section when the headset is paired, and keeps its status told of the line.
 * Returns how to stop.
 */
export function showServerStatus(
  elements: ServerStatusElements,
  paired: boolean,
  line: Pick<ServerLink, 'onConnectionChange'>,
): () => void {
  if (!paired) {
    elements.section.hidden = true;
    return () => undefined;
  }
  elements.section.hidden = false;
  return line.onConnectionChange((connected) => {
    elements.status.textContent = serverStatusText(connected);
  });
}
