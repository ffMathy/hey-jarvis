import { useCallback, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { theme } from './theme';

interface TypedMessageFieldProps {
  /** Given the typed message once it is sent. Never called with only whitespace. */
  onSend: (message: string) => void;
  /** Whether there is a conversation to send into yet. */
  enabled: boolean;
  /**
   * Whether one is still on its way, as opposed to there being none at all.
   *
   * The two used to be the same word. A field that says "Connecting…" whenever it cannot send is a
   * field that says "Connecting…" for ever once the connecting has stopped — which is how a
   * session that failed to open looked, and what the screen was actually reporting when the
   * microphone was switched off.
   */
  opening: boolean;
}

/**
 * Typing to Jarvis, for when talking to him is not an option.
 *
 * This is what the browser falls back to when the microphone is refused — see the note in
 * `conversation-screen.tsx` on why that is a fallback rather than a failure. It is a debugging
 * affordance first: a conversation you can drive from the keyboard is one you can hold in an open
 * office, in a call, or on a machine whose microphone is busy, and one whose input is repeatable
 * from one run to the next in a way that speaking never is.
 *
 * Enter sends, which is the whole interaction. There is deliberately no send button: a button would
 * be a second thing to look at on a screen whose entire argument is that it has nothing on it, and
 * anyone typing to an assistant is already holding the key that means "go".
 *
 * The field keeps focus after sending (`submitBehavior="submit"`), because the thing you almost
 * always want next is to type again, and a field that blurs after every line turns a conversation
 * into a series of clicks.
 */
export function TypedMessageField({ onSend, enabled, opening }: TypedMessageFieldProps) {
  const [draft, setDraft] = useState('');

  const send = useCallback(() => {
    const message = draft.trim();
    // Enter on an empty field is someone thinking, not someone sending. Leaving the draft alone
    // when there is no conversation yet means a line typed while it is still connecting is still
    // there to send a moment later, rather than silently swallowed.
    if (!message || !enabled) {
      return;
    }

    onSend(message);
    setDraft('');
  }, [draft, enabled, onSend]);

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onSubmitEditing={send}
      submitBehavior="submit"
      editable={enabled}
      placeholder={enabled ? 'Type to Jarvis' : opening ? 'Connecting…' : 'Not connected'}
      placeholderTextColor={theme.colors.mutedText}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="send"
      accessibilityLabel="Type a message to Jarvis"
      style={styles.field}
      testID="typed-message"
    />
  );
}

const styles = StyleSheet.create({
  /**
   * Under the sphere, and quiet about it.
   *
   * Absolutely positioned for the same reason the frame rate and the settings link are: the sphere
   * is centred in the whole screen and is wider than it, so anything that took part in the layout
   * would push him off the middle.
   */
  field: {
    position: 'absolute',
    bottom: theme.spacing.huge * 2,
    left: theme.spacing.large,
    right: theme.spacing.large,
    maxWidth: 520,
    marginHorizontal: 'auto',
    paddingVertical: theme.spacing.small,
    paddingHorizontal: theme.spacing.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    textAlign: 'center',
  },
});
