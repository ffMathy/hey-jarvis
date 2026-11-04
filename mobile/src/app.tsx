// This import has to come first, and it has to be this package.
//
// `@elevenlabs/react-native` is a side-effect module: importing it installs the
// WebRTC globals and registers the React Native voice session strategy on
// `@elevenlabs/client` — which is what the conversation dials with, through
// `useJarvisSession` in `hologram/conversation`. Nothing else is taken from it
// any more (the conversation no longer goes through its React provider), but
// without this line the strategy is never registered, and the first attempt to
// talk fails at runtime with "No voice session setup strategy registered". In
// the web build the same import resolves to the SDK's browser build, and it is
// `@elevenlabs/client`'s own browser entry that registers the browser's strategy.
import '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { AgentSatellitesContext, useAgentSatellites, useJarvisServer } from 'hologram/react/lifecycle';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useAnswerTheWatch } from './answer-the-watch';
import { chooseScreen, type Screen } from './app-screen';
import { isAssistLaunch } from './assist-link';
import { conversationCredentialsOf } from './conversation-credentials';
import { ConversationScreen } from './conversation-screen';
import { GlanceScreen } from './glance-screen';
import { firstOnboardingStep } from './onboarding';
import { OnboardingScreen } from './onboarding-screen';
import { hasWalkedOnboarding, rememberOnboardingWalked } from './onboarding-storage';
import { SampleScreen } from './sample-screen';
import { SettingsScreen } from './settings-screen';
import { theme } from './theme';
import { useOpeningGlance } from './use-opening-glance';
import { usePairing } from './use-pairing';

export interface AppProps {
  /**
   * Set when the app is being drawn into the assistant's own window rather than its own.
   *
   * An initial prop from the native side — `JarvisVoiceInteractionSession` puts it there when it
   * renders this component into the window the system draws over whatever was on screen. There is
   * no launch URL in that case, because nothing was launched, so this is how a summoning announces
   * itself there.
   */
  summoned?: boolean;
  /**
   * Which showing of the assistant's window this is: a number that changes every time the window
   * is shown, and is only ever set in that window. See `SHOWING_PROP` in `assistant-window.ts`.
   */
  showing?: number;
}

/**
 * The whole app: a conversation, and the pairing it needs in order to happen.
 *
 * No router. Two screens, one of which only exists until the other one can work,
 * is a `useState` — and an assistant that has to load a navigation tree before it
 * can answer is an assistant that answers late. The third, sample mode, is a
 * side trip from setup and back — and where a summoning lands when there is
 * nothing set up yet.
 */
export function App({ summoned = false, showing }: AppProps) {
  const launchUrl = Linking.useURL();
  // Two ways in, and they are genuinely different: the assistant's own window renders this
  // component directly, with nothing launched and so no URL to read, while a plain ASSIST intent
  // opens the app's own window with one.
  const wasSummoned = summoned || isAssistLaunch(launchUrl);
  /** The pairing with sir's Jarvis server, the only setting the app has: see `use-pairing.ts`. */
  const { serverAddress, pairing, isRead, keepPairingAddress, savePairing, forgetServer } = usePairing(
    showing,
    launchUrl,
  );
  /** Where each conversation's token comes from: see `conversation-credentials.ts`. */
  const credentials = useMemo(() => conversationCredentialsOf(pairing?.address, pairing?.deviceToken), [pairing]);
  /**
   * Whether the first-run tour is already behind this install.
   *
   * True until told otherwise, so that nothing shows a tour in the frame before the answer
   * arrives — and so that a store that cannot be read shows none either. See
   * `onboarding-storage.ts`.
   */
  const [hasWalkedTour, setHasWalkedTour] = useState(true);
  const [isTourRead, setIsTourRead] = useState(false);
  const isLoaded = isRead && isTourRead;
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSampling, setIsSampling] = useState(false);

  // Hands the pairing to the watch whenever it asks, and whenever it is new, for as long as this app
  // is open. See `answer-the-watch.ts`.
  useAnswerTheWatch(pairing);
  // The line to sir's Jarvis server, open for as long as the app runs and is paired, whatever screen
  // is showing and whether or not he is talking to Jarvis (`jarvis-server-link.ts` in hologram).
  const serverLink = useJarvisServer(pairing?.address, 'phone', pairing?.deviceToken);
  // Which of his agents a request is using, from that line, drawn round him on whichever screen shows
  // him (`AgentSatellitesContext`). Sample mode has its own, pretended (`sample-screen.tsx`).
  const satellites = useAgentSatellites(serverLink);
  // The page the server made ahead of time for sir to look at, shown when the app is opened rather
  // than summoned (`app-screen.ts`), and what decides whether it is showing.
  const opening = useOpeningGlance(serverLink, pairing?.address);
  const { glance } = opening;

  // Read beside the pairing: one read that never throws. See `onboarding-storage.ts`.
  useEffect(() => {
    let wanted = true;
    void hasWalkedOnboarding().then((walked) => {
      if (wanted) {
        setHasWalkedTour(walked);
        setIsTourRead(true);
      }
    });
    return () => {
      wanted = false;
    };
  }, []);

  // A new pairing — from the browser's request, or the link the server's pairing page opened the app
  // with — takes the settings screen away, for the conversation it makes possible.
  const deviceToken = pairing?.deviceToken;
  useEffect(() => {
    if (deviceToken) setIsEditingSettings(false);
  }, [deviceToken]);

  // Summoned before there is anything to summon: show the hologram rather than a
  // form. Someone who pressed the assistant button asked for Jarvis, and a
  // settings screen is the least Jarvis-like answer available — sample mode at
  // least moves for them. Tapping beside him still leaves for setup, and this
  // does not fire again once they have gone there, because nothing it depends on
  // has changed.
  useEffect(() => {
    if (wasSummoned && isLoaded && credentials === undefined) {
      setIsSampling(true);
    }
  }, [wasSummoned, isLoaded, credentials]);

  /**
   * The tour is over, and is not to be offered again.
   *
   * Remembered rather than inferred from the pairing being there, because the last step comes
   * *after* it is made: see `onboarding-storage.ts`.
   */
  const finishTour = () => {
    setHasWalkedTour(true);
    void rememberOnboardingWalked();
  };

  const screen = chooseScreen({
    isLoaded,
    // Read beside the pairing, so the first screen already knows of a kept glance.
    isGlanceRead: opening.read,
    isPaired: credentials !== undefined,
    isEditingSettings,
    isSampling,
    isTouring: isTouring({ hasWalkedTour, wasSummoned, isPaired: pairing !== undefined }),
    wasSummoned,
    glance,
    wantsToTalk: opening.wantsToTalk,
    conversationUnderWay: opening.conversationUnderWay,
  });

  const conversationInSheet = isConversationInSheet(wasSummoned);
  const isSeeThrough = isScreenSeeThrough(screen, conversationInSheet);

  return (
    <AgentSatellitesContext.Provider value={satellites}>
      <StatusBar style="light" />
      <View style={[styles.root, isSeeThrough ? styles.seeThrough : styles.opaque]}>
        {screen === 'loading' ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {screen === 'sample' ? (
          <SampleScreen inAssistantWindow={summoned} showing={showing} onLeave={() => setIsSampling(false)} />
        ) : null}
        {screen === 'onboarding' ? (
          <OnboardingScreen
            serverAddress={serverAddress}
            pairing={pairing}
            onPaired={savePairing}
            onPairingAddress={keepPairingAddress}
            onFinished={finishTour}
            onSkipToSample={() => setIsSampling(true)}
          />
        ) : null}
        {screen === 'settings' ? (
          <SettingsScreen
            serverAddress={serverAddress}
            pairing={pairing}
            onPaired={savePairing}
            onPairingAddress={keepPairingAddress}
            onForgetServer={forgetServer}
            onCancel={credentials ? () => setIsEditingSettings(false) : undefined}
            onTrySample={credentials ? undefined : () => setIsSampling(true)}
          />
        ) : null}
        {screen === 'glance' && glance && serverLink ? (
          <GlanceScreen glance={glance} requestAction={serverLink.requestGlanceAction} onTalk={opening.startTalking} />
        ) : null}
        {screen === 'conversation' && credentials ? (
          <ConversationScreen
            credentials={credentials}
            serverAddress={serverAddress}
            onEditSettings={() => setIsEditingSettings(true)}
            inSheet={conversationInSheet}
            inAssistantWindow={summoned}
            showing={showing}
            onUnderWayChange={opening.setConversationUnderWay}
            onGone={opening.conversationOver}
            onBackToGlance={screenBackToGlance(wasSummoned, glance, opening.backToGlance)}
          />
        ) : null}
      </View>
    </AgentSatellitesContext.Provider>
  );
}

/**
 * Whether the tour is showing: until it has been walked, and never to somebody who just made the
 * assistant gesture — they asked for Jarvis, and the answer to that is him (sample mode, if there is
 * nothing set up) rather than a guided tour. Nothing left to walk is the same as having walked it: a
 * browser paired before the tour finished has no step remaining, since the assistant step does not
 * exist there.
 */
function isTouring({
  hasWalkedTour,
  wasSummoned,
  isPaired,
}: {
  hasWalkedTour: boolean;
  wasSummoned: boolean;
  isPaired: boolean;
}): boolean {
  if (hasWalkedTour || wasSummoned) return false;
  return firstOnboardingStep({ canBeTheAssistant: Platform.OS === 'android', isPaired }) !== undefined;
}

/** The way back from a conversation to the glance: only opened rather than summoned, and only to one there is. */
function screenBackToGlance(wasSummoned: boolean, glance: unknown, backToGlance: () => void) {
  return glance !== undefined && !wasSummoned ? backToGlance : undefined;
}

/**
 * Whether a conversation arrives in the same bottom sheet sample mode does, over whatever was on
 * screen, rather than blacking it out: when summoned, on a phone. See `conversation-sheet.tsx`.
 */
function isConversationInSheet(wasSummoned: boolean): boolean {
  return wasSummoned && Platform.OS === 'android';
}

/** Whether the root is left unpainted, so that what is behind the app shows around a sheet. */
function isScreenSeeThrough(screen: Screen, conversationInSheet: boolean): boolean {
  return screen === 'sample' || (screen === 'conversation' && conversationInSheet);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  /**
   * The app's window is see-through — see `withTransparentWindow` in `app.config.ts` — so
   * whatever paints a background has to be here. Everything but sample mode wants one.
   */
  opaque: {
    backgroundColor: theme.colors.background,
  },
  /**
   * Sample mode floats over the home screen, and paints its own scrim instead.
   *
   * On Android only. A browser has nothing behind the page to float over, so leaving the root
   * unpainted there shows the document's own white — which is what the published site looked
   * like: Jarvis on a white page. On web it keeps the same dark the rest of the app uses.
   */
  seeThrough: {
    backgroundColor: Platform.OS === 'android' ? 'transparent' : theme.colors.background,
  },
});
