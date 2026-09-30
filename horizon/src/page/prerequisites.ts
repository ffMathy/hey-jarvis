/**
 * What the page's one big button says, and does, on the way into the room.
 *
 * Entering the room is the end of a short walk: the browser has to be able to open one, there has
 * to be an ElevenLabs agent to talk to, the models that hear "Hey Jarvis" have to be loaded, and
 * the microphone has to be allowed. The button always names the first of those that is not yet
 * done — so it is at once the instructions and the way through them — and is only clickable when
 * clicking it is the next step.
 *
 * **The microphone is its own tap, before the room.** Quest Browser cannot show its permission
 * prompt inside an immersive session, so a microphone first asked for in the room is never granted.
 * The page asks on the 2D panel, where the prompt can appear, and skips the step entirely when the
 * permission is already there.
 *
 * Pure, so the walk is pinned by `prerequisites.spec.ts`; `page.ts` only draws what this says.
 */

export type XrSupport = 'checking' | 'supported' | 'unsupported';

/** How far the models and the rest of what the room needs have got. */
export type PreparationState =
  | { state: 'running'; fraction: number }
  | { state: 'done' }
  | { state: 'failed'; problem: string };

/** The microphone permission, as far as the page knows it; `asking` while its prompt is up. */
export type MicrophoneState = 'granted' | 'denied' | 'prompt' | 'unknown' | 'asking';

/** Where the user is: on this page, on the way into the room, or in it. */
export type RoomState = 'outside' | 'entering' | 'inside';

export interface PageFacts {
  xr: XrSupport;
  hasSettings: boolean;
  preparation: PreparationState;
  /** Undefined when the room needs no microphone at all — a room with no wake engine in it. */
  microphone: MicrophoneState | undefined;
  room: RoomState;
}

export type PrimaryAction = 'none' | 'retry-preparation' | 'ask-microphone' | 'enter-room';

export interface PrimaryButton {
  label: string;
  enabled: boolean;
  action: PrimaryAction;
  /** 0–1 while something is loading, for the bar under the button. */
  progress?: number;
}

function waiting(label: string, progress?: number): PrimaryButton {
  return progress === undefined
    ? { label, enabled: false, action: 'none' }
    : { label, enabled: false, action: 'none', progress };
}

function microphoneStep(microphone: MicrophoneState | undefined): PrimaryButton | undefined {
  switch (microphone) {
    case 'asking':
      return waiting('Allow the microphone…');
    case 'denied':
      return waiting('The microphone is blocked');
    case 'prompt':
    case 'unknown':
      return { label: 'Allow the microphone', enabled: true, action: 'ask-microphone' };
    default:
      return undefined;
  }
}

/** The button for the first step not yet done. */
export function primaryButton(facts: PageFacts): PrimaryButton {
  if (facts.xr === 'checking') return waiting('Checking this browser…');
  if (facts.xr === 'unsupported') return waiting('Open this page on a Meta Quest');
  if (facts.room === 'entering') return waiting('Opening your room…');
  if (facts.room === 'inside') return waiting('Jarvis is in your room');
  if (!facts.hasSettings) return waiting('Add your ElevenLabs key first');
  const { preparation } = facts;
  if (preparation.state === 'running') {
    const fraction = Math.max(0, Math.min(1, preparation.fraction));
    return waiting(`Getting Jarvis ready… ${Math.floor(fraction * 100)}%`, fraction);
  }
  if (preparation.state === 'failed')
    return { label: 'Try getting ready again', enabled: true, action: 'retry-preparation' };
  return microphoneStep(facts.microphone) ?? { label: 'Enter your room', enabled: true, action: 'enter-room' };
}

/**
 * Whether "Try him in your room" can be used: sample mode needs no key, no models and no
 * microphone, only a browser that can open a room and nobody already in it.
 */
export function canTrySample(facts: PageFacts): boolean {
  return facts.xr === 'supported' && facts.room === 'outside';
}

/**
 * What to tell someone whose microphone is blocked, or nothing when it is not.
 *
 * A refusal is remembered by the browser, so asking again does nothing: the only way back is the
 * site's permissions, which on Quest Browser are behind the lock icon beside the address.
 */
export function microphoneHelp(microphone: MicrophoneState | undefined): string | undefined {
  if (microphone !== 'denied') return undefined;
  return (
    'Quest Browser is blocking the microphone for this page, so Jarvis cannot hear “Hey Jarvis”. ' +
    'Select the lock icon beside the address, allow the microphone, then reload this page. ' +
    'You can still try him in your room without it.'
  );
}
