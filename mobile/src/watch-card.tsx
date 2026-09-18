import type { ElevenLabsSettings } from 'hologram';
import { useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { findWatch, openJarvisOnTheWatch, type PairedWatch, sendSettingsToTheWatch } from '../modules/jarvis-watch';
import { theme } from './theme';

/**
 * Whether Jarvis has a Play Store listing for the watch to install from.
 *
 * **False, and it is the one thing standing between this card and the button working.** An
 * internal testing track is enough — a private listing, up to a hundred testers by invitation, and
 * none of the twelve-testers-for-fourteen-days that gates production. Set this to true the day
 * that exists, and the card stops explaining and starts offering.
 *
 * It also settles the signing question on its own: Play signs both APKs with the same key, which
 * is what the Data Layer requires before a phone and a watch will speak to each other at all.
 */
const JARVIS_IS_ON_PLAY = false;

interface WatchCardProps {
  /**
   * The credentials to offer the watch, when there are any.
   *
   * Undefined on the tour's last step before they are saved — which cannot happen, since that step
   * comes after the credentials one — and on any screen that has none. The card then says Jarvis is
   * there without offering a handover, which is the truth.
   */
  settings: ElevenLabsSettings | undefined;
}

/** Nothing found, and what is shown until the first answer comes back. */
const NOTHING_YET: PairedWatch = { paired: false, name: undefined, hasJarvis: false };

/**
 * Whether there is a watch beside this phone, and whether Jarvis is on it.
 *
 * Asked again every time the app comes back to the front, because the one moment this card exists
 * for is the moment the user has just installed it on the watch — and they do that by leaving.
 */
function usePairedWatch(): PairedWatch {
  const isForeground = useIsForeground();
  const [watch, setWatch] = useState(NOTHING_YET);

  useEffect(() => {
    if (!isForeground) {
      return;
    }
    let current = true;
    void findWatch().then((found) => {
      if (current) {
        setWatch(found);
      }
    });
    return () => {
      current = false;
    };
  }, [isForeground]);

  return watch;
}

/**
 * Jarvis on the watch: whether he is there, how to put him there, and the key he needs once he is.
 *
 * Two cards in one, because the answer to "what is worth saying about the watch" changes entirely
 * with whether the app is on it.
 *
 * **He is there.** Then what the watch is missing is the ElevenLabs credentials, and this is where
 * they are handed over — see `sendSettingsToTheWatch`. The watch never asks for them on its own
 * keyboard, and the phone's is the only one they should ever be typed on. It usually happens
 * without this button: the watch asks whenever it starts with none and `answer-the-watch.ts`
 * answers, so the button is for the case where the watch was not running when it mattered, and for
 * rotating a key.
 *
 * **He is not.** Then the only thing worth offering is a way to install him, and there is barely
 * one — read on.
 *
 * **The install button opens a page; it does not install anything.** No Android app can install on
 * a paired watch — the package installer has to run on the watch with somebody tapping through it,
 * and the one thing that can be started remotely is a browsable link. So this opens Jarvis's Play
 * Store page on the watch, which is precisely what Home Assistant's watch button does and what
 * everybody means by "install from the phone". The route that genuinely worked out of band, an APK
 * embedded in the phone app, died with Wear OS 1.
 *
 * It therefore needs a Play listing to land on, which Jarvis does not have yet. Until then the
 * watch is side-loaded with `adb` — see `watch/AGENTS.md` — and the button says so rather than
 * sending the user to a page that will tell them the item was not found.
 */
export function WatchCard({ settings }: WatchCardProps) {
  const watch = usePairedWatch();

  // The Data Layer is Android's, and a browser has no watch beside it.
  if (Platform.OS !== 'android' || !watch.paired) {
    return null;
  }

  const name = watch.name ?? 'your watch';

  return watch.hasJarvis ? <HandingOverTheKey name={name} settings={settings} /> : <PuttingHimOnTheWatch name={name} />;
}

/**
 * He is on the watch, so what is left is the credentials it needs in order to use him.
 *
 * Three states rather than two, because "sent" is worth showing: the handover is silent on this
 * side — the watch stores it and says nothing back — so without a word here there is no way to
 * tell a successful send from a button that did nothing.
 */
function HandingOverTheKey({ name, settings }: { name: string; settings: ElevenLabsSettings | undefined }) {
  const [handover, setHandover] = useState<'ready' | 'sending' | 'sent'>('ready');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const send = useCallback(() => {
    if (!settings) {
      return;
    }
    setHandover('sending');
    setProblem(undefined);
    void sendSettingsToTheWatch(settings).then((sent) => {
      setHandover(sent ? 'sent' : 'ready');
      if (!sent) {
        setProblem(
          'The watch would not take the credentials. It may be out of range, or Jarvis may not be running on it.',
        );
      }
    });
  }, [settings]);

  return (
    <View style={styles.card} testID="watch-card">
      <Text style={styles.cardHeading}>Jarvis is on {name}</Text>
      <Text style={styles.cardBody}>Hold the side button there, and he answers on your wrist too.</Text>

      {settings ? (
        <>
          <Text style={styles.cardBody}>
            {handover === 'sent'
              ? `Sent. ${name} keeps them in its own keystore, and can hold a conversation on its own from now on.`
              : 'The watch needs the same ElevenLabs key and agent. Send them across rather than typing them on a watch.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.cardButton}
            disabled={handover === 'sending'}
            onPress={send}
            testID="send-to-watch"
          >
            {handover === 'sending' ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.cardButtonLabel}>
                {handover === 'sent' ? `Send to ${name} again` : `Send the key to ${name}`}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}

      {problem ? (
        <Text style={styles.problem} testID="watch-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * He is not on the watch, and the only thing on offer is a page somebody taps install on there.
 *
 * Which needs a Play listing to land on, so until there is one this says how the watch is
 * side-loaded instead rather than sending anybody to a page that will tell them the item was not
 * found. See `JARVIS_IS_ON_PLAY`.
 */
function PuttingHimOnTheWatch({ name }: { name: string }) {
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const open = useCallback(() => {
    setOpening(true);
    setProblem(undefined);
    void openJarvisOnTheWatch().then((opened) => {
      setOpening(false);
      if (!opened) {
        setProblem('The watch would not open the Play Store. It may be out of range.');
      }
    });
  }, []);

  return (
    <View style={styles.card} testID="watch-card">
      <Text style={styles.cardHeading}>Jarvis is not on {name} yet</Text>
      {JARVIS_IS_ON_PLAY ? (
        <>
          <Text style={styles.cardBody}>
            Opening the Play Store on the watch is as far as a phone is allowed to go — the install itself happens
            there.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.cardButton}
            disabled={opening}
            onPress={open}
            testID="install-on-watch"
          >
            {opening ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.cardButtonLabel}>Install on {name}</Text>
            )}
          </Pressable>
        </>
      ) : (
        <Text style={styles.cardBody}>
          There is no Play Store listing to install from yet, so the watch app has to be side-loaded over wireless
          debugging for now.
        </Text>
      )}
      {problem ? (
        <Text style={styles.problem} testID="watch-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.spacing.medium,
    gap: theme.spacing.small,
  },
  cardHeading: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cardBody: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  cardButton: {
    marginTop: theme.spacing.small,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  cardButtonLabel: {
    color: theme.colors.accentText,
    fontWeight: '600',
  },
  problem: {
    color: theme.colors.danger,
  },
});
