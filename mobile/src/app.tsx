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
import type { ElevenLabsSettings } from 'hologram';
import { useJarvisServer } from 'hologram/react/lifecycle';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useAnswerTheWatch } from './answer-the-watch';
import { isAssistLaunch } from './assist-link';
import { ConversationScreen } from './conversation-screen';
import {
  type JarvisServerChange,
  loadJarvisServerAddress,
  loadJarvisServerToken,
  saveJarvisServerAddress,
  saveJarvisServerToken,
} from './jarvis-server';
import { firstOnboardingStep } from './onboarding';
import { OnboardingScreen } from './onboarding-screen';
import { hasWalkedOnboarding, rememberOnboardingWalked } from './onboarding-storage';
import { readTryingAgain } from './read-again';
import { SampleScreen } from './sample-screen';
import { SettingsScreen } from './settings-screen';
import { loadElevenLabsSettings, saveElevenLabsSettings } from './settings-storage';
import { theme } from './theme';

/**
 * The Jarvis server's address to use: the one read, or none — an address that still cannot be read
 * after `readTryingAgain` has tried is no address, so the camera stays off rather than guessing.
 */
async function readJarvisServerAddress(stillWanted: () => boolean): Promise<string | undefined> {
  const stored = await readTryingAgain(loadJarvisServerAddress, stillWanted);
  return stored?.kind === 'address' ? stored.address : undefined;
}

/** The token for the server to use, read as the address is: one that still cannot be read is none. */
async function readJarvisServerToken(stillWanted: () => boolean): Promise<string | undefined> {
  const stored = await readTryingAgain(loadJarvisServerToken, stillWanted);
  return stored?.kind === 'token' ? stored.token : undefined;
}

/** Which screen is showing. */
type Screen = 'loading' | 'sample' | 'onboarding' | 'settings' | 'conversation';

/**
 * Which one, given everything that has a say in it.
 *
 * The order is the argument. Sample mode comes first because it is a side trip taken *from*
 * somewhere and returned to — including from the tour, where it is offered on every step. The tour
 * comes next because a first run has nothing else worth showing. The bare settings screen is what
 * is left for an install that has been through the tour and has no credentials any more, which is
 * where this app opened before there was a tour at all.
 */
function chooseScreen(state: {
  isLoaded: boolean;
  hasSettings: boolean;
  isEditingSettings: boolean;
  isSampling: boolean;
  isTouring: boolean;
}): Screen {
  if (!state.isLoaded) {
    return 'loading';
  }
  if (state.isSampling) {
    return 'sample';
  }
  if (state.isTouring) {
    return 'onboarding';
  }
  if (!state.hasSettings) {
    return 'settings';
  }
  return state.isEditingSettings ? 'settings' : 'conversation';
}

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
 * The whole app: a conversation, and the settings it needs in order to happen.
 *
 * No router. Two screens, one of which only exists until the other one can work,
 * is a `useState` — and an assistant that has to load a navigation tree before it
 * can answer is an assistant that answers late. The third, sample mode, is a
 * side trip from setup and back — and where a summoning lands when there is
 * nothing set up yet.
 */
export function App({ summoned = false, showing }: AppProps) {
  const [settings, setSettings] = useState<ElevenLabsSettings | undefined>(undefined);
  /**
   * Where sir's Jarvis server is, if he has told this phone: where the camera button sends a photo,
   * and where this phone and the watch open their line to the server during a conversation.
   *
   * Beside the settings rather than in them: it is not ElevenLabs'. The watch is handed both
   * (`useAnswerTheWatch` below). See `jarvis-server.ts`.
   */
  const [serverAddress, setServerAddress] = useState<string | undefined>(undefined);
  /**
   * The JWT the Cloudflare Zero Trust application in front of the server accepts, if sir has given
   * one: sent with this phone's and the watch's line to the server. See `jarvis-server.ts`.
   */
  const [serverToken, setServerToken] = useState<string | undefined>(undefined);
  /**
   * Whether the first-run tour is already behind this install.
   *
   * True until told otherwise, so that nothing shows a tour in the frame before the answer
   * arrives — and so that a store that cannot be read shows none either. See
   * `onboarding-storage.ts`.
   */
  const [hasWalkedTour, setHasWalkedTour] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSampling, setIsSampling] = useState(false);

  // Hands the credentials to the watch whenever it asks, for as long as this app is open. See
  // `answer-the-watch.ts`; the watch only ever asks when it has none of its own.
  useAnswerTheWatch(settings, serverAddress, serverToken);
  // The line to sir's Jarvis server, open for as long as the app runs and has an address, whatever
  // screen is showing and whether or not he is talking to Jarvis (`jarvis-server-link.ts` in hologram).
  useJarvisServer(serverAddress, serverToken, 'phone');

  const launchUrl = Linking.useURL();
  // Two ways in, and they are genuinely different: the assistant's own window renders this
  // component directly, with nothing launched and so no URL to read, while a plain ASSIST intent
  // opens the app's own window with one.
  const wasSummoned = summoned || isAssistLaunch(launchUrl);

  /**
   * Reads the settings, and tries again if the *reading* failed rather than the settings being
   * absent — see `read-again.ts` for the blank sheet that answering both the same way caused. If
   * every attempt fails the settings screen opens, which is the right answer for a keystore that
   * genuinely cannot be read any more.
   */
  useEffect(() => {
    let wanted = true;
    const stillWanted = () => wanted;
    void (async () => {
      // Started here and awaited below: the tour flag is one read that never throws, and making
      // it wait its turn behind the retries would hold the whole app on a spinner. The Jarvis
      // server's address is read beside the settings, and retried beside them, since the two fail
      // together; it is read before the conversation opens, so the first one already knows whether
      // there is a camera to offer.
      const walking = hasWalkedOnboarding();
      const readingServerAddress = readJarvisServerAddress(stillWanted);
      const readingServerToken = readJarvisServerToken(stillWanted);

      const stored = await readTryingAgain(loadElevenLabsSettings, stillWanted);
      if (stored?.kind === 'settings') {
        setSettings(stored.settings);
      }

      const walked = await walking;
      const storedServerAddress = await readingServerAddress;
      const storedServerToken = await readingServerToken;
      if (wanted) {
        setHasWalkedTour(walked);
        setServerAddress(storedServerAddress);
        setServerToken(storedServerToken);
        setIsLoaded(true);
      }
    })();
    return () => {
      wanted = false;
    };
  }, []);

  /**
   * Reads the Jarvis server's address again for every summoning after the first.
   *
   * **This window may not be where it was changed.** The assistant's window is kept between
   * summonings, with its own copy of everything read when it was made, and the address is as often
   * set in the app's own window — the one the launcher opens, where the settings are most often
   * reached. Read once, an address saved there never reached the window Jarvis is summoned into, and
   * one cleared there went on being offered from it. A summoning is a new `showing` in the
   * assistant's window and a new launch URL in the app's own, so either is read as one. The settings
   * stay as they were read, as they always have: this is about the address, which only the camera
   * uses.
   */
  const seenSummoning = useRef({ showing, launchUrl });
  useEffect(() => {
    if (showing === seenSummoning.current.showing && launchUrl === seenSummoning.current.launchUrl) {
      return;
    }
    seenSummoning.current = { showing, launchUrl };
    let wanted = true;
    void Promise.all([readJarvisServerAddress(() => wanted), readJarvisServerToken(() => wanted)]).then(
      ([storedServerAddress, storedServerToken]) => {
        if (wanted) {
          setServerAddress(storedServerAddress);
          setServerToken(storedServerToken);
        }
      },
    );
    return () => {
      wanted = false;
    };
  }, [showing, launchUrl]);

  // Summoned before there is anything to summon: show the hologram rather than a
  // form. Someone who pressed the assistant button asked for Jarvis, and a
  // settings screen is the least Jarvis-like answer available — sample mode at
  // least listens to them. Tapping beside him still leaves for setup, and this
  // does not fire again once they have gone there, because nothing it depends on
  // has changed.
  useEffect(() => {
    if (wasSummoned && isLoaded && settings === undefined) {
      setIsSampling(true);
    }
  }, [wasSummoned, isLoaded, settings]);

  const save = (saved: ElevenLabsSettings) => {
    setSettings(saved);
    setIsEditingSettings(false);
    void saveElevenLabsSettings(saved);
  };

  /**
   * The settings screen saves the Jarvis server's address with the rest, when sir changed it — and
   * only then, so an address that could not be read is never overwritten by the empty field that
   * stood in for it. The tour never asks for one.
   */
  const saveSettingsScreen = (saved: ElevenLabsSettings, serverChange: JarvisServerChange | undefined) => {
    if (serverChange) {
      setServerAddress(serverChange.address);
      setServerToken(serverChange.token);
      void saveJarvisServerAddress(serverChange.address);
      void saveJarvisServerToken(serverChange.token);
    }
    save(saved);
  };

  /**
   * The tour is over, and is not to be offered again.
   *
   * Remembered rather than inferred from the credentials being there, because the last step comes
   * *after* they are saved: see `onboarding-storage.ts`.
   */
  const finishTour = () => {
    setHasWalkedTour(true);
    void rememberOnboardingWalked();
  };

  // Nothing left to walk is the same as having walked it — a browser whose credentials were saved
  // before the tour finished has no step remaining, since the assistant step does not exist there.
  const tourHasSteps =
    firstOnboardingStep({
      canBeTheAssistant: Platform.OS === 'android',
      hasSettings: settings !== undefined,
    }) !== undefined;

  const screen = chooseScreen({
    isLoaded,
    hasSettings: settings !== undefined,
    isEditingSettings,
    isSampling,
    // Never to somebody who just made the assistant gesture. They asked for Jarvis, and the answer
    // to that is him — sample mode, if there is nothing set up — rather than a guided tour.
    isTouring: !hasWalkedTour && !wasSummoned && tourHasSteps,
  });

  const conversationInSheet = isConversationInSheet(wasSummoned);
  const isSeeThrough = isScreenSeeThrough(screen, conversationInSheet);

  return (
    <>
      <StatusBar style="light" />
      <View style={[styles.root, isSeeThrough ? styles.seeThrough : styles.opaque]}>
        {screen === 'loading' ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {screen === 'sample' ? (
          <SampleScreen inAssistantWindow={summoned} showing={showing} onLeave={() => setIsSampling(false)} />
        ) : null}
        {screen === 'onboarding' ? (
          <OnboardingScreen
            settings={settings}
            onSaveSettings={save}
            onFinished={finishTour}
            onSkipToSample={() => setIsSampling(true)}
          />
        ) : null}
        {screen === 'settings' ? (
          <SettingsScreen
            settings={settings}
            serverAddress={serverAddress}
            serverToken={serverToken}
            onSave={saveSettingsScreen}
            onCancel={settings ? () => setIsEditingSettings(false) : undefined}
            onTrySample={settings ? undefined : () => setIsSampling(true)}
          />
        ) : null}
        {screen === 'conversation' && settings ? (
          <ConversationScreen
            settings={settings}
            serverAddress={serverAddress}
            onEditSettings={() => setIsEditingSettings(true)}
            inSheet={conversationInSheet}
            inAssistantWindow={summoned}
            showing={showing}
          />
        ) : null}
      </View>
    </>
  );
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
