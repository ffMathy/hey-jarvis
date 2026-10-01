import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { PICKER_GIVE_UP_AFTER_MS, takePhoto } from './take-photo.web';

/**
 * A file input, as much of one as the picker uses, and what became of it: whether it is on the page,
 * and whether anything read what was picked in it.
 */
class FakePicker extends EventTarget {
  type = '';
  accept = '';
  readonly style = { display: '' };
  onPage = false;
  picked: File[] = [];
  timesRead = 0;

  get files(): File[] {
    this.timesRead += 1;
    return this.picked;
  }

  setAttribute(_name: string, _value: string): void {}

  click(): void {}

  remove(): void {
    this.onPage = false;
  }
}

/**
 * The browser's picker, left open for longer than anyone is still framing a shot: a desktop's chooser
 * behind another window, or a phone put down. The browser answers neither `change` nor `cancel`, and
 * while it is open the camera button keeps the call alive, so the picker has to end it itself.
 */
describe('the browser’s picker', () => {
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let picker: FakePicker;

  beforeEach(() => {
    picker = new FakePicker();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => picker,
        body: {
          append: (element: FakePicker) => {
            element.onPage = true;
          },
        },
      },
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (documentBefore) {
      Object.defineProperty(globalThis, 'document', documentBefore);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  function openThePicker() {
    return takePhoto({ inAssistantWindow: false, stillTalking: () => true });
  }

  it('is taken as closed once it has been open as long as the phone’s camera may be', async () => {
    const answer = openThePicker();
    jest.advanceTimersByTime(PICKER_GIVE_UP_AFTER_MS - 1);
    expect(picker.onPage).toBe(true);

    jest.advanceTimersByTime(1);

    expect(picker.onPage).toBe(false);
    expect(await answer).toEqual({ closed: true });
  });

  it('sends nothing picked after it was given up on', async () => {
    const answer = openThePicker();
    jest.advanceTimersByTime(PICKER_GIVE_UP_AFTER_MS);

    picker.picked = [new File([new Uint8Array([0xff, 0xd8])], 'receipt.jpg', { type: 'image/jpeg' })];
    picker.dispatchEvent(new Event('change'));

    expect(picker.timesRead).toBe(0);
    expect(await answer).toEqual({ closed: true });
  });

  it('leaves no timer behind when it is answered in time', async () => {
    const answer = openThePicker();
    jest.advanceTimersByTime(5_000);

    picker.dispatchEvent(new Event('cancel'));

    expect(await answer).toEqual({ closed: true });
    expect(picker.onPage).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
