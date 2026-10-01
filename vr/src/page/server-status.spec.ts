import { describe, expect, it } from 'bun:test';
import { type ServerStatusElements, serverSignInUrl, serverStatusText, showServerStatus } from './server-status';

/** Stand-ins for the page's elements: only the properties the status writes. */
function fakeElements(): ServerStatusElements {
  return {
    section: { hidden: true },
    status: { textContent: '' },
    signIn: { hidden: true },
    signInLink: { href: '' },
  };
}

/** A line whose connection is set by hand. */
function fakeLine() {
  let listener: ((connected: boolean) => void) | undefined;
  return {
    line: {
      onConnectionChange: (next: (connected: boolean) => void) => {
        listener = next;
        next(false);
        return () => {
          listener = undefined;
        };
      },
    },
    setConnected: (connected: boolean) => listener?.(connected),
  };
}

describe('the server’s status on the page', () => {
  it('links to the socket’s own path, which sends a browser through the Access login', () => {
    expect(serverSignInUrl('https://jarvis.example.com')).toBe('https://jarvis.example.com/api/live');
  });

  it('offers signing in only while the line is not connected', () => {
    const elements = fakeElements();
    const { line, setConnected } = fakeLine();
    showServerStatus(elements, 'https://jarvis.example.com', line);

    expect(elements.section.hidden).toBe(false);
    expect(elements.signInLink.href).toBe('https://jarvis.example.com/api/live');
    expect(elements.status.textContent).toBe(serverStatusText(false));
    expect(elements.signIn.hidden).toBe(false);

    setConnected(true);
    expect(elements.status.textContent).toBe(serverStatusText(true));
    expect(elements.signIn.hidden).toBe(true);

    setConnected(false);
    expect(elements.signIn.hidden).toBe(false);
  });

  it('shows nothing about a server the page has no address for', () => {
    const elements = fakeElements();
    elements.section.hidden = false;
    showServerStatus(elements, undefined, fakeLine().line);
    expect(elements.section.hidden).toBe(true);
  });
});
