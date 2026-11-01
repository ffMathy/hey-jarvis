import { type Glance, type GlanceActionResult, glanceOrigin } from 'hologram';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { confirmGlanceAction } from './confirm-glance-action';
import { runGlanceAction } from './glance-actions';
import { GlanceView } from './glance-view';
import type { GlanceViewHandle } from './platform-contracts';
import { theme } from './theme';

interface GlanceScreenProps {
  glance: Glance;
  /** Asks the server to run one of the glance's actions (`ServerLink.requestGlanceAction`). */
  requestAction: (glanceId: string, actionId: string) => Promise<GlanceActionResult>;
  /** Sir wants to talk to Jarvis: the conversation screen, as a summoning would open it. */
  onTalk: () => void;
}

/** How long the line saying how an action went stays up in a browser. A phone says it in a toast. */
const NOTICE_SECONDS = 4;

/** The size of the button that brings Jarvis, and of the glow round it. */
const TALK_BUTTON_SIZE = 56;
const TALK_GLOW_SIZE = 76;

/**
 * What the app opens on from the launcher, once the server has made a glance: the page it made, the
 * whole screen of it, and one small way to Jarvis at the bottom.
 *
 * **The page is the server's; the questions are the phone's.** Its buttons name an action by id
 * (`window.jarvis.act`), and the action is only run once sir has said yes in a native dialog showing
 * the prompt the server holds for it — see `glance-actions.ts` for why the page's own words cannot be
 * trusted. One at a time: a press while a question or a request is still out is ignored, so a page
 * cannot stack dialogs. How it went is told back to the page, and to sir: a toast on a phone, a line
 * over the page in a browser.
 *
 * **Jarvis is a tap away, and only a tap.** A small round button, glowing his copper, sits over the
 * bottom of the page: tapping it opens the conversation screen, exactly as a summoning would, and the
 * conversation ending — or pressing back — comes back here. It is the one thing this screen draws
 * over the page, and it is small for that reason: the page is what sir opened the app to see.
 */
export function GlanceScreen({ glance, requestAction, onTalk }: GlanceScreenProps) {
  const page = useRef<GlanceViewHandle>(null);
  const busy = useRef(false);
  const [notice, setNotice] = useState<GlanceActionResult | undefined>(undefined);

  useEffect(() => {
    if (notice === undefined) return;
    const hiding = setTimeout(() => setNotice(undefined), NOTICE_SECONDS * 1000);
    return () => clearTimeout(hiding);
  }, [notice]);

  const report = useCallback((result: GlanceActionResult) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(result.message, ToastAndroid.SHORT);
      return;
    }
    setNotice(result);
  }, []);

  const onAction = useCallback(
    (actionId: string) => {
      if (busy.current) return;
      busy.current = true;
      void runGlanceAction({
        glance,
        actionId,
        confirm: confirmGlanceAction,
        request: requestAction,
        deliver: (result) => page.current?.deliverResult(result),
        report,
      }).finally(() => {
        busy.current = false;
      });
    },
    [glance, requestAction, report],
  );

  const origin = glanceOrigin(glance.url);

  return (
    <View style={styles.screen} testID="glance">
      {origin === undefined ? null : (
        <GlanceView ref={page} url={glance.url} origin={origin} title={glance.title} onAction={onAction} />
      )}

      {notice ? (
        <Text
          style={[styles.notice, notice.ok ? styles.noticeDone : styles.noticeFailed]}
          testID="glance-notice"
          accessibilityLiveRegion="polite"
        >
          {notice.message}
        </Text>
      ) : null}

      <View style={styles.talkPlace} pointerEvents="box-none">
        <View style={styles.talkGlow} pointerEvents="none" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Talk to Jarvis"
          onPress={onTalk}
          style={({ pressed }) => [styles.talkButton, pressed ? styles.talkButtonPressed : null]}
          testID="talk-to-jarvis"
        >
          <View style={styles.talkCore} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: theme.colors.background,
  },
  /** Centred over the bottom of the page, clear of the gesture bar. */
  talkPlace: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing.large,
    height: TALK_GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** His glow: a soft copper disc behind the button, see-through enough to leave the page readable. */
  talkGlow: {
    position: 'absolute',
    width: TALK_GLOW_SIZE,
    height: TALK_GLOW_SIZE,
    borderRadius: TALK_GLOW_SIZE / 2,
    backgroundColor: theme.colors.jarvisGlow,
    opacity: 0.22,
  },
  /** A dark round button ringed in his copper, so it reads on a light page and a dark one alike. */
  talkButton: {
    width: TALK_BUTTON_SIZE,
    height: TALK_BUTTON_SIZE,
    borderRadius: TALK_BUTTON_SIZE / 2,
    backgroundColor: theme.colors.background,
    borderWidth: 2,
    borderColor: theme.colors.jarvis,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.jarvis,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  talkButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
  /** The white-hot core in the middle of him, small. */
  talkCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.jarvisCore,
    shadowColor: theme.colors.jarvis,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  /** How an action went, in a browser: one line over the page, above the button. */
  notice: {
    position: 'absolute',
    left: theme.spacing.large,
    right: theme.spacing.large,
    bottom: theme.spacing.large + TALK_GLOW_SIZE + theme.spacing.small,
    padding: theme.spacing.small,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.surface,
    textAlign: 'center',
    overflow: 'hidden',
  },
  noticeDone: {
    color: theme.colors.success,
  },
  noticeFailed: {
    color: theme.colors.danger,
  },
});
