import {
  afterMessage,
  afterSpokenMessage,
  type ConversationMessage,
  SAYING_NOTHING,
  type WrittenReply,
} from './written-reply';

/**
 * Which of Jarvis's lines are written down in a conversation, and when they are taken away again.
 *
 * Three rules, one per way of holding a conversation, and what each shows follows
 * `written-reply.ts` exactly: his line replaces what is shown, yours clears it, and a blank line
 * from him changes nothing. They differ in when anything is shown at all.
 *
 * - {@link createWrittenCaption}: while you are writing to him on a headset.
 * - {@link createTextModeCaption}: while a phone's conversation is held in writing.
 * - {@link createTextOnlyCaption}: every line, in the conversation that has no voice at all.
 *
 * In a spoken exchange none of them shows anything: his answer is his voice, and a transcript under
 * the sphere is what it was drawn not to need.
 */
export interface SessionCaption {
  /** A line of the conversation, as `onMessage` reports it. */
  heard(message: ConversationMessage): void;
  /** A line was typed and sent: what was shown answered the last one, so it goes. */
  typed(text: string): void;
  /** The user started or stopped writing instead of talking. */
  setTyping(typing: boolean): void;
  /** A new conversation: nothing written, nothing shown. */
  reset(): void;
  /** The conversation has ended: what the rule does with a line still shown. */
  ended(): void;
  /** What is shown now, and whether he is still delivering it. */
  readonly reply: WrittenReply;
}

/**
 * Keeps the reply, and says so whenever what is on screen would change — the words, or how long
 * he goes on delivering them.
 */
function createReplyKeeper(onChange: (reply: WrittenReply) => void) {
  let reply: WrittenReply = SAYING_NOTHING;
  return {
    show(next: WrittenReply) {
      const changed = next.shown !== reply.shown || next.readingUntil !== reply.readingUntil;
      reply = next;
      if (changed) {
        onChange(reply);
      }
    },
    get reply() {
      return reply;
    },
  };
}

/** A line's words alone, so the same sentence transcribed back matches what was typed. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * His line in writing, under him in the room, while you are writing to him.
 *
 * The phone's text mode, on a headset. There, tapping him switches the conversation into writing
 * (see {@link createTextModeCaption}). A headset has no tap for that, only a keyboard that comes and
 * goes — so writing here is *the keyboard being up, or the last thing you said being typed*. The
 * second half is what shows his answer at all: the keyboard closes as the line is sent, and the
 * answer comes after.
 *
 * Shown through `afterSpokenMessage`, because he is also saying it out loud and the sphere follows
 * his real voice rather than miming the text.
 *
 * **Speaking again ends it.** A transcript of the user that is not the typed line coming back is
 * the user talking, so the conversation is spoken again and the caption goes. Whether ElevenLabs
 * echoes a typed line back as a transcript is not documented, so an echo is recognised by its
 * words and simply ignored, and a missing one costs nothing. **And so does the conversation
 * ending**: the room keeps nothing under a hologram that has gone.
 */
export function createWrittenCaption(onChange: (reply: WrittenReply) => void): SessionCaption {
  const keeper = createReplyKeeper(onChange);
  let typing = false;
  let lastTyped: string | undefined;

  const writing = () => typing || lastTyped !== undefined;

  const heardUser = (message: ConversationMessage) => {
    if (lastTyped !== undefined && wordsOf(message.message) === wordsOf(lastTyped)) {
      return;
    }
    if (!typing) {
      lastTyped = undefined;
    }
    keeper.show(afterSpokenMessage(keeper.reply, message));
  };

  const reset = () => {
    typing = false;
    lastTyped = undefined;
    keeper.show(SAYING_NOTHING);
  };

  return {
    heard: (message) => {
      if (message.role === 'user') {
        heardUser(message);
        return;
      }
      if (writing()) {
        keeper.show(afterSpokenMessage(keeper.reply, message));
      }
    },
    typed: (text) => {
      lastTyped = text;
      keeper.show(SAYING_NOTHING);
    },
    setTyping: (next) => {
      typing = next;
    },
    reset,
    ended: reset,
    get reply() {
      return keeper.reply;
    },
  };
}

/**
 * His line in writing while a phone's conversation is held in writing: its text mode.
 *
 * **A phone cannot switch to the text-only session a browser falls back to** —
 * `@elevenlabs/react-native` refuses WebSocket sessions on a device — so tapping Jarvis keeps the
 * voice session up and only switches off the half that listens: the microphone is muted (the
 * session's `setTyping`), a field comes up under him, and his answers are written above it as well
 * as spoken. Tapping him again undoes all of it.
 *
 * **He still answers out loud**, as he does when you type to him in a browser or in ElevenLabs' own
 * preview: writing to him is a way to be heard without speaking, not a request for silence. So his
 * lines go through `afterSpokenMessage`, which shows them without miming them, and the sphere
 * follows his real voice.
 *
 * Every switch, either way, clears what was written: it belonged to the other mode. A line written
 * before he left stays until the screen takes it away with him.
 */
export function createTextModeCaption(onChange: (reply: WrittenReply) => void): SessionCaption {
  const keeper = createReplyKeeper(onChange);
  let typing = false;

  return {
    heard: (message) => {
      if (typing) {
        keeper.show(afterSpokenMessage(keeper.reply, message));
      }
    },
    typed: () => keeper.show(SAYING_NOTHING),
    setTyping: (next) => {
      typing = next;
      keeper.show(SAYING_NOTHING);
    },
    reset: () => {
      typing = false;
      keeper.show(SAYING_NOTHING);
    },
    ended: () => undefined,
    get reply() {
      return keeper.reply;
    },
  };
}

/**
 * Every line he writes, in the conversation held in writing on both sides.
 *
 * A browser that refused the microphone holds its conversation as text, so his reply arrives as an
 * `agent_response` and never as audio — and until this was shown, typing a question there got a
 * silent sphere and nothing to read. So every line is shown, and through `afterMessage`, which also
 * says how long he should look like he is delivering it (on `now`'s clock): with no voice to follow,
 * the screen mimes it. It is the one conversation where the words are shown because there is
 * nothing to listen to.
 *
 * A line you send clears the last answer at once rather than when the line comes back, because a
 * conversation held in writing runs no speech recognition and may never echo it. A line written
 * before he left stays until the screen takes it away with him.
 */
export function createTextOnlyCaption(onChange: (reply: WrittenReply) => void, now: () => number): SessionCaption {
  const keeper = createReplyKeeper(onChange);
  return {
    heard: (message) => keeper.show(afterMessage(keeper.reply, message, now())),
    typed: () => keeper.show(SAYING_NOTHING),
    setTyping: () => undefined,
    reset: () => keeper.show(SAYING_NOTHING),
    ended: () => undefined,
    get reply() {
      return keeper.reply;
    },
  };
}
