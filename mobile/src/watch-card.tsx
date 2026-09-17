import { useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { findWatch, openJarvisOnTheWatch, type PairedWatch } from '../modules/jarvis-watch';
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
 * Jarvis on the watch: whether he is there, and the only way to put him there.
 *
 * **The button opens a page; it does not install anything.** No Android app can install an app on
 * a paired watch — the package installer has to run on the watch with somebody tapping through it,
 * and the one thing that can be started remotely is a browsable link. So this opens Jarvis's Play
 * Store page on the watch, which is precisely what Home Assistant's watch button does and what
 * everybody means by "install from the phone". The route that genuinely worked out of band, an APK
 * embedded in the phone app, died with Wear OS 1.
 *
 * It therefore needs a Play listing to land on, which Jarvis does not have yet. Until then the
 * watch is side-loaded with `adb` — see `wear/AGENTS.md` — and the button says so rather than
 * sending the user to a page that will tell them the item was not found.
 */
export function WatchCard() {
  const watch = usePairedWatch();
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

  // The Data Layer is Android's, and a browser has no watch beside it.
  if (Platform.OS !== 'android' || !watch.paired) {
    return null;
  }

  const name = watch.name ?? 'your watch';

  if (watch.hasJarvis) {
    return (
      <View style={styles.card} testID="watch-card">
        <Text style={styles.cardHeading}>Jarvis is on {name}</Text>
        <Text style={styles.cardBody}>Hold the side button there, and he answers on your wrist too.</Text>
      </View>
    );
  }

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
