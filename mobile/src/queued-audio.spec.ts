import { describe, expect, it } from 'bun:test';
import { flushQueuedAudio } from './queued-audio';

/**
 * A media element as LiveKit leaves one: playing a stream, and remembering everything it has been
 * handed, so a test can watch it being emptied rather than only see where it ended up.
 */
function playingElement(stream: object | null = { id: 'jarvis' }) {
  const assigned: unknown[] = [];
  let playing: unknown = stream;

  return {
    assigned,
    plays: 0,
    get srcObject(): unknown {
      return playing;
    },
    set srcObject(value: unknown) {
      playing = value;
      assigned.push(value);
    },
    play(): Promise<void> {
      this.plays++;
      return Promise.resolve();
    },
  };
}

/** A LiveKit track playing through `elements` — which on a phone would be none of them. */
function trackPlayingThrough(...elements: object[]) {
  return { mediaStreamTrack: { id: 'jarvis' }, attachedElements: elements };
}

describe('flushQueuedAudio', () => {
  it('empties the element and puts the same stream back, so playback resumes at the live edge', () => {
    const stream = { id: 'jarvis' };
    const element = playingElement(stream);

    const flushed = flushQueuedAudio([trackPlayingThrough(element)]);

    expect(flushed).toBe(1);
    // Cleared first — that is what tears the element's renderer down and takes the queued audio
    // with it — and only then given the same live stream again.
    expect(element.assigned).toEqual([null, stream]);
    expect(element.srcObject).toBe(stream);
    expect(element.plays).toBe(1);
  });

  it('flushes every element of every track, since a track can be attached more than once', () => {
    const first = playingElement();
    const second = playingElement();
    const third = playingElement();

    const flushed = flushQueuedAudio([trackPlayingThrough(first, second), trackPlayingThrough(third)]);

    expect(flushed).toBe(3);
    for (const element of [first, second, third]) {
      expect(element.assigned).toHaveLength(2);
    }
  });

  it('leaves an element with nothing playing alone, rather than handing it null twice', () => {
    const empty = playingElement(null);

    expect(flushQueuedAudio([trackPlayingThrough(empty)])).toBe(0);
    expect(empty.assigned).toEqual([]);
    expect(empty.plays).toBe(0);
  });

  it('does nothing on a phone, where the track is played natively and has no elements', () => {
    // `attachedElements` is LiveKit's, and it only ever fills in a browser. One empty loop is the
    // whole of what an interruption costs on Android.
    expect(flushQueuedAudio([{ mediaStreamTrack: { id: 'jarvis' } }])).toBe(0);
    expect(flushQueuedAudio([trackPlayingThrough()])).toBe(0);
    expect(flushQueuedAudio([])).toBe(0);
  });

  it('ignores whatever else is on the track, rather than trusting the field to hold elements', () => {
    const notElements = { mediaStreamTrack: {}, attachedElements: ['an element', null, {}] };

    expect(flushQueuedAudio([notElements])).toBe(0);
  });

  it('survives a browser that refuses to replay, since a refusal is nothing the user can act on', () => {
    const refusing = {
      srcObject: { id: 'jarvis' } as unknown,
      play: () => Promise.reject(new Error('NotAllowedError')),
    };

    expect(() => flushQueuedAudio([trackPlayingThrough(refusing)])).not.toThrow();
    expect(refusing.srcObject).toEqual({ id: 'jarvis' });
  });
});
