import { ScrollView, StyleSheet, Text } from 'react-native';
import { theme } from './theme';

interface WrittenReplyLineProps {
  /** The last thing Jarvis said in writing. */
  reply: string;
}

/**
 * Jarvis's answer, on the one screen that has no voice to carry it.
 *
 * **This exists because the text-only conversation was write-only.** A browser with the microphone
 * refused holds the session as text on both sides, so his reply arrives as an `agent_response` and
 * never as audio — and nothing rendered it, so typing a question got a silent sphere and no answer.
 * See `written-reply.ts` for why only the last line is kept.
 *
 * It is deliberately quiet: muted text, no bubble, no name in front of it. There is only one other
 * person in this conversation, so saying who is talking is a word nobody needs to read, and a chat
 * transcript is exactly the shape this screen was built to avoid. It sits above the field rather
 * than below it, because that is the order the two were written in.
 *
 * A long answer scrolls rather than growing, and is capped at roughly a third of the way up. He can
 * be asked something that takes a paragraph, and a paragraph that pushed the field off the bottom
 * of the screen would take the way to reply with it.
 */
export function WrittenReplyLine({ reply }: WrittenReplyLineProps) {
  return (
    <ScrollView
      style={styles.frame}
      contentContainerStyle={styles.content}
      // The sphere is the screen; this is something to read on top of it, and the drawing beneath
      // should still take a long press for settings wherever the text itself is not.
      showsVerticalScrollIndicator={false}
      testID="written-reply"
    >
      <Text style={styles.reply} accessibilityLabel={`Jarvis said: ${reply}`}>
        {reply}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /**
   * Above the field, and absolutely positioned for the reason everything else on this screen is:
   * the sphere is centred in the whole screen and wider than it, so anything taking part in the
   * layout would push him off the middle. See `typed-message-field.tsx`.
   */
  frame: {
    position: 'absolute',
    bottom: theme.spacing.huge * 3,
    left: theme.spacing.large,
    right: theme.spacing.large,
    maxWidth: 520,
    maxHeight: 160,
    marginHorizontal: 'auto',
  },
  content: {
    paddingVertical: theme.spacing.small,
  },
  reply: {
    color: theme.colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
});
