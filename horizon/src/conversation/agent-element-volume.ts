/**
 * The volume of the SDK's hidden `<audio>` elements: 0 while his voice comes from where he stands,
 * 1 otherwise.
 *
 * **The element has to keep playing.** Chromium only pulls a remote WebRTC track while a media
 * element with that track is being rendered (crbug 933677, still open): take the element away, or
 * pause it, and Web Audio gets silence. So the element that plays him from the headset stays in the
 * page and playing while his spatial voice is heard, and is only made inaudible.
 *
 * **Volume, not `muted`.** Chromium applies the element's volume after the point where Web Audio
 * takes the track, so at volume 0 the panner still gets him at full scale — and `muted` would do
 * the same, but LiveKit sets `muted = false` again every time it attaches an element and every time
 * the microphone is acquired (`Room.startAudio`). Nothing in LiveKit or the SDK touches `volume`
 * unless asked to, and this app never asks.
 *
 * **Every element, whenever it appears.** The SDK attaches his track when he joins and again after
 * a resubscription, so the volume is applied to every element on the page playing a live stream
 * whenever it is set, and to every new one as it arrives — from LiveKit's `ElementAttached` and from
 * watching the page for elements appended to it. An element playing a file (the greeting's) has no
 * stream and is never touched, nor is one whose stream has ended, which `orphaned-audio.ts` clears.
 */

/** As much of a media element as its volume takes. `HTMLAudioElement` has it all. */
export interface VolumeElement {
  srcObject: unknown;
  volume: number;
}

/** Whether a track is one that is still playing. */
function isLive(track: unknown): boolean {
  return typeof track === 'object' && track !== null && Reflect.get(track, 'readyState') === 'live';
}

/** The audio tracks of a `MediaStream`, read structurally; none for anything that is not one. */
function audioTracksOf(stream: unknown): unknown[] {
  if (typeof stream !== 'object' || stream === null) return [];
  const getAudioTracks: unknown = Reflect.get(stream, 'getAudioTracks');
  if (typeof getAudioTracks !== 'function') return [];
  const tracks: unknown = Reflect.apply(getAudioTracks, stream, []);
  return Array.isArray(tracks) ? tracks : [];
}

/** Whether `candidate` is an element playing a stream with a live audio track: one of the SDK's. */
export function isAgentElement(candidate: unknown): candidate is VolumeElement {
  if (typeof candidate !== 'object' || candidate === null) return false;
  if (typeof Reflect.get(candidate, 'volume') !== 'number') return false;
  return audioTracksOf(Reflect.get(candidate, 'srcObject')).some(isLive);
}

export interface AgentElementVolume {
  /** The volume every one of the SDK's elements should have. */
  readonly volume: number;
  /** Sets it on every element there is, and on every one that arrives from now on. */
  set(volume: number): void;
  /** An element LiveKit has just attached his track to, wherever it is. */
  adopt(element: unknown): void;
  /** How many of the SDK's elements it has seen that are still live, for the HUD. */
  readonly elements: number;
  dispose(): void;
}

/** Where the elements are found, and how new ones are noticed. */
export interface ElementSources {
  /** Every media element on the page now. */
  onPage(): Iterable<unknown>;
  /** Calls `onAdded` with everything added to the page from now on; returns how to stop. */
  watchAdded(onAdded: (node: unknown) => void): () => void;
}

export function createAgentElementVolume(sources: ElementSources): AgentElementVolume {
  let volume = 1;
  // Elements attached but not in the page — LiveKit's `ElementAttached` can come before the SDK
  // appends one — are kept here too, and forgotten once their stream has ended.
  let adopted: VolumeElement[] = [];

  const apply = (candidate: unknown) => {
    if (isAgentElement(candidate) && candidate.volume !== volume) candidate.volume = volume;
  };

  const everyElement = (): VolumeElement[] => {
    adopted = adopted.filter(isAgentElement);
    const found = new Set<VolumeElement>(adopted);
    for (const candidate of sources.onPage()) if (isAgentElement(candidate)) found.add(candidate);
    return [...found];
  };

  const stopWatching = sources.watchAdded(apply);

  return {
    get volume() {
      return volume;
    },
    set: (next) => {
      volume = next;
      for (const element of everyElement()) apply(element);
    },
    adopt: (element) => {
      if (!isAgentElement(element)) return;
      if (!adopted.includes(element)) adopted.push(element);
      apply(element);
    },
    get elements() {
      return everyElement().length;
    },
    dispose: () => {
      stopWatching();
      adopted = [];
    },
  };
}

/** The page's own elements, and a `MutationObserver` on its body for the ones the SDK appends. */
export function pageElementSources(document: Document): ElementSources {
  return {
    onPage: () => document.querySelectorAll('audio, video'),
    watchAdded: (onAdded) => {
      if (typeof MutationObserver === 'undefined' || document.body === null) return () => undefined;
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) onAdded(node);
      });
      // The SDK appends its elements to the body itself, so the body's own children are enough.
      observer.observe(document.body, { childList: true });
      return () => observer.disconnect();
    },
  };
}
