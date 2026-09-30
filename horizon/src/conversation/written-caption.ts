import { afterSpokenMessage, type ConversationMessage, SAYING_NOTHING, type WrittenReply } from 'hologram';

/**
 * His line in writing, under him in the room, while you are writing to him.
 *
 * The phone's text mode, on a headset. There, tapping him switches the conversation into writing:
 * the microphone is muted, a field comes up, and his answers are shown as well as spoken
 * (`mobile/src/text-mode.ts`). A headset has no tap for that, only a keyboard that comes and goes
 * — so writing here is *the keyboard being up, or the last thing you said being typed*. The second
 * half is what shows his answer at all: the keyboard closes as the line is sent, and the answer
 * comes after.
 *
 * What is shown follows `written-reply.ts` exactly — his line replaces the caption, yours clears
 * it, a blank line from him changes nothing — through `afterSpokenMessage`, because he is also
 * saying it out loud and the sphere follows his real voice rather than miming the text. In a
 * spoken exchange nothing is shown: his answer is his voice, and a transcript floating under the
 * hologram is what it was drawn not to need.
 *
 * **Speaking again ends it.** A transcript of the user that is not the typed line coming back is
 * the user talking, so the conversation is spoken again and the caption goes. Whether ElevenLabs
 * echoes a typed line back as a transcript is not documented, so an echo is recognised by its
 * words and simply ignored, and a missing one costs nothing.
 */
export interface WrittenCaption {
  /** A line of the conversation, as `onMessage` reports it. */
  heard(message: ConversationMessage): void;
  /** A line was typed and sent: what was shown answered the last one, so it goes. */
  typed(text: string): void;
  /** The keyboard came up or went down. */
  setTyping(typing: boolean): void;
  /** A new conversation: nothing written, nothing shown. */
  reset(): void;
  /** What is shown now, if anything. */
  readonly shown: string | undefined;
}

/** A line's words alone, so the same sentence transcribed back matches what was typed. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function createWrittenCaption(onChange: (text: string | undefined) => void): WrittenCaption {
  let reply: WrittenReply = SAYING_NOTHING;
  let typing = false;
  let lastTyped: string | undefined;

  const show = (next: WrittenReply) => {
    const changed = next.shown !== reply.shown;
    reply = next;
    if (changed) {
      onChange(reply.shown);
    }
  };

  const writing = () => typing || lastTyped !== undefined;

  const heardUser = (message: ConversationMessage) => {
    if (lastTyped !== undefined && wordsOf(message.message) === wordsOf(lastTyped)) {
      return;
    }
    if (!typing) {
      lastTyped = undefined;
    }
    show(afterSpokenMessage(reply, message));
  };

  return {
    heard: (message) => {
      if (message.role === 'user') {
        heardUser(message);
        return;
      }
      if (writing()) {
        show(afterSpokenMessage(reply, message));
      }
    },
    typed: (text) => {
      lastTyped = text;
      show(SAYING_NOTHING);
    },
    setTyping: (next) => {
      typing = next;
    },
    reset: () => {
      typing = false;
      lastTyped = undefined;
      show(SAYING_NOTHING);
    },
    get shown() {
      return reply.shown;
    },
  };
}
