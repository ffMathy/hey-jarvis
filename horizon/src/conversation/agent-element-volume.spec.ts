import { describe, expect, it } from 'bun:test';
import { createAgentElementVolume, isAgentElement } from './agent-element-volume';

/** A stream whose audio tracks are in the given states, as a `MediaStream` reports them. */
function stream(...states: string[]) {
  const tracks = states.map((readyState) => ({ kind: 'audio', readyState }));
  return { getAudioTracks: () => tracks, getTracks: () => tracks };
}

/** A media element, as the SDK's hidden `<audio>` or the greeting's, with what the rule reads and writes. */
function element(srcObject: unknown, extra: { src?: string } = {}) {
  return { srcObject, volume: 1, muted: false, paused: false, src: extra.src ?? '', pauses: 0 };
}

/** A page whose elements the test lists, and whose appended elements it announces. */
function createPage() {
  const onPage: unknown[] = [];
  let announce: ((node: unknown) => void) | undefined;
  let watching = false;
  return {
    onPage,
    sources: {
      onPage: () => onPage,
      watchAdded: (onAdded: (node: unknown) => void) => {
        announce = onAdded;
        watching = true;
        return () => {
          watching = false;
        };
      },
    },
    append(node: unknown) {
      onPage.push(node);
      if (watching) announce?.(node);
    },
    get watching() {
      return watching;
    },
  };
}

describe('which elements are the SDK’s', () => {
  it('is every element playing a stream with a live audio track', () => {
    expect(isAgentElement(element(stream('live')))).toBe(true);
    expect(isAgentElement(element(stream('ended', 'live')))).toBe(true);
  });

  it('is never the greeting’s, which plays a file, nor one whose stream has ended', () => {
    expect(isAgentElement(element(null, { src: 'greeting.mp3' }))).toBe(false);
    expect(isAgentElement(element(stream('ended')))).toBe(false);
    expect(isAgentElement(element(stream()))).toBe(false);
    expect(isAgentElement({ srcObject: stream('live') })).toBe(false);
    expect(isAgentElement('audio')).toBe(false);
  });
});

describe('the SDK elements’ volume', () => {
  it('silences every one on the page by volume, never by muting or pausing it', () => {
    const page = createPage();
    const his = element(stream('live'));
    const greeting = element(null, { src: 'greeting.mp3' });
    page.onPage.push(his, greeting);
    const volume = createAgentElementVolume(page.sources);

    volume.set(0);

    expect(his.volume).toBe(0);
    expect(his.muted).toBe(false);
    expect(his.paused).toBe(false);
    expect(greeting.volume).toBe(1);
  });

  it('silences one appended afterwards the moment it arrives, and restores every one at once', () => {
    const page = createPage();
    const volume = createAgentElementVolume(page.sources);
    volume.set(0);

    const later = element(stream('live'));
    page.append(later);
    expect(later.volume).toBe(0);

    volume.set(1);
    expect(later.volume).toBe(1);
    expect(volume.elements).toBe(1);
  });

  it('silences one LiveKit attached before it reached the page, and forgets it once it has ended', () => {
    const page = createPage();
    const volume = createAgentElementVolume(page.sources);
    volume.set(0);
    const tracks = [{ readyState: 'live' }];
    const detached = element({ getAudioTracks: () => tracks });

    volume.adopt(detached);
    expect(detached.volume).toBe(0);
    expect(volume.elements).toBe(1);

    const [track] = tracks;
    if (track !== undefined) track.readyState = 'ended';
    expect(volume.elements).toBe(0);
  });

  it('leaves anything that is not one of the SDK’s alone, however it arrives', () => {
    const page = createPage();
    const volume = createAgentElementVolume(page.sources);
    volume.set(0);
    const greeting = element(null, { src: 'greeting.mp3' });
    page.append(greeting);
    volume.adopt(greeting);
    expect(greeting.volume).toBe(1);
    expect(volume.elements).toBe(0);
  });

  it('starts at full volume, and stops watching the page once disposed', () => {
    const page = createPage();
    const volume = createAgentElementVolume(page.sources);
    expect(volume.volume).toBe(1);
    expect(page.watching).toBe(true);
    volume.dispose();
    expect(page.watching).toBe(false);
  });
});
