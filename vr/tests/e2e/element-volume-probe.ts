import { createAgentElementVolume, pageElementSources } from '../../src/conversation/agent-element-volume';

/**
 * The rule for the SDK's hidden `<audio>` elements, run in the page against real ones.
 *
 * The app cannot be shown a real agent track offline — ElevenLabs and LiveKit are out of reach in
 * the browser tests — so what the unit tests check against fakes is checked here against the
 * browser's own objects: that an element playing a live `MediaStream` is found and made inaudible
 * by its volume, never muted or paused, whether it was on the page already or appended afterwards;
 * that an element playing a file, like the greeting's, and one whose stream has ended are left
 * alone; and that all of it comes back at once. Bundled into an init script by the spec, like the
 * harness, so it never reaches the production build.
 */

/** One element as the rule left it. */
export interface ElementState {
  volume: number;
  muted: boolean;
  paused: boolean;
  connected: boolean;
}

export interface ElementVolumeProbeResult {
  /** Silenced: a live stream already on the page, one appended afterwards, the greeting, an ended stream. */
  silenced: Record<'already' | 'appended' | 'greeting' | 'ended', ElementState>;
  /** The same four once the volume is back. */
  restored: Record<'already' | 'appended' | 'greeting' | 'ended', ElementState>;
  /** How many of the SDK's elements the rule counted while they were silent. */
  counted: number;
}

declare global {
  interface Window {
    __elementVolumeProbe?: () => Promise<ElementVolumeProbeResult>;
  }
}

/** A live audio stream with a tone in it, as a remote track would be: nothing needs to be heard. */
function liveStream(context: AudioContext): MediaStream {
  const destination = context.createMediaStreamDestination();
  const tone = context.createOscillator();
  tone.connect(destination);
  tone.start();
  return destination.stream;
}

function hiddenAudio(): HTMLAudioElement {
  const element = document.createElement('audio');
  element.autoplay = true;
  element.style.display = 'none';
  return element;
}

function stateOf(element: HTMLAudioElement): ElementState {
  return { volume: element.volume, muted: element.muted, paused: element.paused, connected: element.isConnected };
}

/** Lets the page's mutation observers run. */
function afterMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function probe(): Promise<ElementVolumeProbeResult> {
  const context = new AudioContext();
  const already = hiddenAudio();
  already.srcObject = liveStream(context);
  document.body.append(already);
  const greeting = hiddenAudio();
  greeting.src = './assets/greeting-that-is-never-loaded.mp3';
  greeting.autoplay = false;
  document.body.append(greeting);
  const ended = hiddenAudio();
  const endedStream = liveStream(context);
  for (const track of endedStream.getTracks()) track.stop();
  ended.srcObject = endedStream;
  document.body.append(ended);
  await Promise.all([already, ended].map((element) => element.play().catch(() => undefined)));

  const volume = createAgentElementVolume(pageElementSources(document));
  volume.set(0);
  // Appended once the voice is spatial, as the SDK appends one when he joins or resubscribes.
  const appended = hiddenAudio();
  appended.srcObject = liveStream(context);
  document.body.append(appended);
  await appended.play().catch(() => undefined);
  await afterMutations();

  const all = { already, appended, greeting, ended };
  const snapshot = () => ({
    already: stateOf(all.already),
    appended: stateOf(all.appended),
    greeting: stateOf(all.greeting),
    ended: stateOf(all.ended),
  });
  const silenced = snapshot();
  const counted = volume.elements;
  volume.set(1);
  const restored = snapshot();
  volume.dispose();
  await context.close();
  return { silenced, restored, counted };
}

window.__elementVolumeProbe = probe;
