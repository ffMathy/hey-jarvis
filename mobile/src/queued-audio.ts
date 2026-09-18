import { useRawConversation } from '@elevenlabs/react-native';
import { useEffect, useMemo, useRef } from 'react';
import { type AgentTrack, agentAudioTracks, roomOfConversation } from './agent-audio-track';

/**
 * As much of a media element as dropping what it has queued needs.
 *
 * Named structurally rather than as `HTMLMediaElement` so that the dropping can be tested without
 * a browser — and because what is reached for here is a field on a LiveKit track that this app
 * does not otherwise declare. A real `<audio>` element has both of these and much more.
 */
export interface QueuedAudioElement {
  srcObject: unknown;
  play(): Promise<void>;
}

/** Whether something is an element with audio to drop, rather than whatever else was on the track. */
function isQueuedAudioElement(candidate: unknown): candidate is QueuedAudioElement {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'srcObject' in candidate &&
    typeof Reflect.get(candidate, 'play') === 'function'
  );
}

/**
 * The elements a track is being played through, which on a phone is none.
 *
 * LiveKit keeps them on the track as `attachedElements`, and only ever fills it in a browser:
 * Android plays the agent's audio through the native WebRTC track, with no element anywhere and
 * nothing of its own to go stale. So everything below is a browser's problem, and on a phone it
 * costs one empty loop per interruption.
 */
function playingElements(track: AgentTrack): QueuedAudioElement[] {
  const attached: unknown = Reflect.get(track, 'attachedElements');
  return Array.isArray(attached) ? attached.filter(isQueuedAudioElement) : [];
}

/**
 * Drops whatever the browser still has queued of Jarvis's voice, and says how many elements it
 * dropped it from.
 *
 * **This is what an interruption costs if nobody does it.** Jarvis is cut off mid-sentence, the
 * server stops sending, and whatever the element had already taken in stays in it — so the tail of
 * the sentence he was cut off in plays at the head of his next one, in the same take, clipped.
 * There is no queue in this app or in the ElevenLabs SDK to clear: over WebRTC the SDK's own
 * `interrupt()` is a documented no-op, because audio is a live LiveKit track rather than chunks
 * the client buffers. The only queue left is the media element's own, and this is the way to empty
 * it — clearing `srcObject` tears the element's renderer down, and putting the same stream back
 * builds a new one at the live edge.
 *
 * Nothing is lost by doing it here: an interruption is precisely the moment there is nothing left
 * worth playing, and the next thing to come down the track is a fresh sentence.
 */
export function flushQueuedAudio(tracks: readonly AgentTrack[]): number {
  let flushed = 0;

  for (const track of tracks) {
    for (const element of playingElements(track)) {
      const playing = element.srcObject;
      if (playing === null || playing === undefined) {
        continue;
      }
      element.srcObject = null;
      element.srcObject = playing;
      flushed++;
      // `autoplay` is set on these by LiveKit, so this is belt and braces — and a browser that
      // refuses it has refused something the user cannot act on, so there is nothing to report.
      element.play().catch(() => {});
    }
  }

  return flushed;
}

/**
 * Handlers for `startSession` that keep a cut-off sentence from being heard twice.
 *
 * Shaped like `useToolActivity`'s: one memoised object of callbacks, spread into the session,
 * which holds them for its lifetime. The conversation is read through a ref rather than closed
 * over, so the handlers stay the same functions while it comes and goes — a new object would mean
 * a new session.
 */
export function useQueuedAudio() {
  const conversation = useRawConversation();
  const conversationNow = useRef<object | undefined>(undefined);

  useEffect(() => {
    conversationNow.current = conversation ?? undefined;
  }, [conversation]);

  const playbackHandlers = useMemo(
    () => ({
      onInterruption: () => {
        const conversationThen = conversationNow.current;
        const room = conversationThen ? roomOfConversation(conversationThen) : undefined;
        if (room) {
          flushQueuedAudio(agentAudioTracks(room));
        }
      },
    }),
    [],
  );

  return { playbackHandlers };
}
