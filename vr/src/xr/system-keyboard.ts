/**
 * Typing to Jarvis from inside the room, with the headset's own keyboard.
 *
 * An immersive page has no DOM on screen, but Quest Browser (26.1 and later) shows its system
 * keyboard over the room when an input element on the page is focused, and types into it. It sends
 * no key events — only the element's value changes — so a line is known to be finished when the
 * value gains a newline, or when the keyboard is dismissed (the element loses focus) with something
 * still typed. The keyboard blurs the XR session while it is up; `app-state.ts` knows that and does
 * not count the time against the call.
 *
 * The element is a `<textarea>` rather than an `<input>`, because Enter in an input submits a form
 * or does nothing, while in a textarea it is the newline this watches for.
 */

/** The finished lines in what has been typed so far, and what is still being typed after them. */
export function splitTypedLines(value: string): { lines: string[]; rest: string } {
  const parts = value.split(/\r?\n/);
  const rest = parts.pop() ?? '';
  return { lines: parts.map((line) => line.trim()).filter((line) => line.length > 0), rest };
}

export interface SystemKeyboard {
  /**
   * Focuses the hidden textarea, which is what brings the keyboard up. Call it from a select
   * handler: focusing needs the user activation the select carries.
   */
  open(): void;
  /** Takes the keyboard down, sending whatever was still typed. */
  close(): void;
  readonly isOpen: boolean;
  /** Each finished line, trimmed and never empty. */
  onLine(listener: (line: string) => void): () => void;
  /** The keyboard went down, for whatever reason. */
  onClose(listener: () => void): () => void;
  dispose(): void;
}

/** The hidden textarea, added to `document`'s body until disposed. */
export function createSystemKeyboard(document: Document): SystemKeyboard {
  const field = document.createElement('textarea');
  field.setAttribute('aria-label', 'Type to Jarvis');
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('enterkeyhint', 'send');
  // Present and focusable, but nowhere a 2D page would show it: in the room there is no page to
  // show it on, and on the page it must not catch a stray click.
  Object.assign(field.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.append(field);

  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<() => void>();
  let open = false;

  function send(line: string) {
    for (const listener of lineListeners) listener(line);
  }

  function onInput() {
    const { lines, rest } = splitTypedLines(field.value);
    if (lines.length === 0) return;
    field.value = rest;
    for (const line of lines) send(line);
  }

  function onBlur() {
    const unfinished = field.value.trim();
    field.value = '';
    if (unfinished) send(unfinished);
    if (!open) return;
    open = false;
    for (const listener of closeListeners) listener();
  }

  field.addEventListener('input', onInput);
  field.addEventListener('blur', onBlur);

  return {
    open() {
      field.value = '';
      open = true;
      field.focus();
    },
    close() {
      field.blur();
    },
    get isOpen() {
      return open;
    },
    onLine(listener) {
      lineListeners.add(listener);
      return () => lineListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    dispose() {
      field.removeEventListener('input', onInput);
      field.removeEventListener('blur', onBlur);
      lineListeners.clear();
      closeListeners.clear();
      field.remove();
    },
  };
}
