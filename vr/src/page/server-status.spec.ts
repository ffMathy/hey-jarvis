import { describe, expect, it } from 'bun:test';
import { type ServerStatusElements, serverStatusText, showServerStatus } from './server-status';

/** Stand-ins for the page's elements: only the properties the status writes. */
function fakeElements(): ServerStatusElements {
  return { section: { hidden: true }, status: { textContent: '' } };
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
  it('follows a paired headset’s line', () => {
    const elements = fakeElements();
    const { line, setConnected } = fakeLine();
    showServerStatus(elements, true, line);

    expect(elements.section.hidden).toBe(false);
    expect(elements.status.textContent).toBe(serverStatusText(false));
    setConnected(true);
    expect(elements.status.textContent).toBe(serverStatusText(true));
  });

  it('shows nothing before the headset is paired, when it has no line', () => {
    const elements = fakeElements();
    elements.section.hidden = false;
    showServerStatus(elements, false, fakeLine().line);
    expect(elements.section.hidden).toBe(true);
  });
});
