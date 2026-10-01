import { describe, expect, it } from 'bun:test';
import { createGreetingPlayer } from './greeting-player';

/** An audio element the test can move along itself: what `GreetingElement` reads, all writable. */
interface FakeElement {
  src: string;
  preload: string;
  currentTime: number;
  muted: boolean;
  duration: number;
  paused: boolean;
  ended: boolean;
  plays: number;
  play(): Promise<void>;
  pause(): void;
}

/** The greeting's element, as far as the session reads it: whether it played, and where it is. */
describe('the greeting player', () => {
  function fakeElement(options: { refuses?: boolean } = {}) {
    const element: FakeElement = {
      src: '',
      preload: '',
      currentTime: 1.9,
      muted: false,
      duration: Number.NaN,
      paused: true,
      ended: false,
      plays: 0,
      play: async () => {
        element.plays++;
        if (options.refuses) {
          throw new DOMException('play() can only be initiated by a user gesture.', 'NotAllowedError');
        }
        element.paused = false;
      },
      pause: () => {
        element.paused = true;
      },
    };
    return element;
  }

  const recording = new URL('https://example.test/vr/assets/greeting-abc.mp3');

  it('loads the recording from its URL, ahead of time', () => {
    const element = fakeElement();
    createGreetingPlayer(recording, () => element);
    expect(element.src).toBe(recording.href);
    expect(element.preload).toBe('auto');
  });

  it('plays from the start, and says so', async () => {
    const element = fakeElement();
    const player = createGreetingPlayer(recording, () => element);

    expect(await player.playFromStart()).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(player.position()).toBe(0);
  });

  it('says when the browser refuses to play it', async () => {
    const player = createGreetingPlayer(recording, () => fakeElement({ refuses: true }));
    expect(await player.playFromStart()).toBe(false);
    expect(player.position()).toBe(-1);
  });

  it('is nowhere once stopped or finished', async () => {
    const element = fakeElement();
    const player = createGreetingPlayer(recording, () => element);
    await player.playFromStart();

    player.stop();
    expect(player.position()).toBe(-1);

    await player.playFromStart();
    element.ended = true;
    expect(player.position()).toBe(-1);
  });

  it('knows its length only once the element does', () => {
    const element = fakeElement();
    const player = createGreetingPlayer(recording, () => element);
    expect(player.duration).toBe(0);

    element.duration = 2.04;
    expect(player.duration).toBe(2.04);
  });

  it('can be unlocked silently inside a gesture, and is left ready to greet from the start', async () => {
    const element = fakeElement();
    const player = createGreetingPlayer(recording, () => element);

    await player.prime();

    expect(element.plays).toBe(1);
    expect(element.paused).toBe(true);
    expect(element.muted).toBe(false);
    expect(element.currentTime).toBe(0);
  });
});
