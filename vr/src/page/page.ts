import {
  type ConversationCredentials,
  pairedCredentials,
  pairWithServer,
  type ServerLink,
  serverSignInUrl,
} from 'hologram';
import type { JarvisDebugState } from '../debug-hook';
import type { MicrophoneGate } from './microphone';
import { HEADSET_DEVICE_NAME, loadPairing, savePairing } from './pairing';
import { type PreparationTask, runPreparation } from './preparation';
import { canOpenWithoutAgent, microphoneHelp, type PageFacts, primaryButton } from './prerequisites';
import { showServerStatus } from './server-status';
import { type KeyValueStorage, loadServerAddress } from './settings';
import { loadVoiceFromWhereHeStands, saveVoiceFromWhereHeStands } from './voice-setting';

/**
 * The 2D page: the one place a headset session can start from — entering an immersive session
 * needs a click — and the place you come back to when it ends.
 *
 * Plain DOM over the markup in `index.html`. What the big button says comes from
 * `prerequisites.ts`; this file keeps the facts it is worked out from current and draws the result:
 * whether this browser can open a room, whether the headset is paired, how far getting ready has got,
 * the microphone permission, and whether the user is in the room. It also owns the pairing form —
 * pairing with sir's Jarvis server is the only way the headset gets a conversation — the "His voice
 * from where he stands" switch (`voice-setting.ts`, read again on every Enter), and the status line,
 * which after a room closes says what went wrong in it, if anything did. Beside the way into the
 * real room are two that need no pairing and no microphone: sample mode, and placing the things
 * Jarvis works on in the room.
 */

/**
 * Which room to open: the real one, sample mode — which opens on a drawer of made-up entities to try
 * placing and pointing with (`entities/sample-entities.ts`) — or one to place the real ones in.
 */
export type RoomMode = 'conversation' | 'sample' | 'placement';

/** What a room hands back to the page when it closes. */
export interface RoomOutcome {
  /** The last problem shown in the room, to show again here. */
  problem?: string;
}

export interface PageDependencies {
  storage: KeyValueStorage;
  fetch: typeof fetch;
  /** Undefined when the room does not listen, so there is no microphone step. */
  microphone: MicrophoneGate | undefined;
  /** What has to be loaded before the real room can be entered. */
  preparations: readonly PreparationTask[];
  canEnterRoom(): Promise<boolean>;
  /**
   * Opens the room and settles when it has closed again, calling `onInside` once the session is
   * open. Called straight from the click, so it must ask for the session before it awaits
   * anything: the click's activation expires.
   */
  enterRoom(
    mode: RoomMode,
    credentials: ConversationCredentials | undefined,
    onInside: () => void,
  ): Promise<RoomOutcome>;
  /**
   * The page's line to sir's Jarvis server, and whether the headset is paired and so has one, for the
   * page to say whether it is connected (`server-status.ts`).
   */
  server: { paired: boolean; line: Pick<ServerLink, 'onConnectionChange'> };
  /** Loads the page again, so a newly paired server's address opens the page's line to it. */
  reload(): void;
  debug: JarvisDebugState;
}

/**
 * Where the room's conversations get their tokens: the Jarvis server this headset is paired with —
 * the server holds the key, and nothing secret but its own token is kept here — or nothing, before
 * the headset is paired.
 */
export function conversationCredentials(storage: KeyValueStorage): ConversationCredentials | undefined {
  const pairing = loadPairing(storage);
  return pairing === undefined ? undefined : pairedCredentials(pairing);
}

function required<Found extends Element>(root: ParentNode, selector: string, kind: new () => Found): Found {
  const element = root.querySelector(selector);
  if (!(element instanceof kind)) throw new Error(`The page has no ${selector}.`);
  return element;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wires the page in `document` to `dependencies`, and starts checking and getting ready. */
export function startPage(document: Document, dependencies: PageDependencies): void {
  const { debug, storage } = dependencies;
  const primary = required(document, '#primary', HTMLButtonElement);
  const progress = required(document, '#progress', HTMLProgressElement);
  const status = required(document, '#status', HTMLElement);
  const help = required(document, '#microphone-help', HTMLElement);
  const sample = required(document, '#sample', HTMLButtonElement);
  const place = required(document, '#place', HTMLButtonElement);
  const spatialVoice = required(document, '#spatial-voice', HTMLInputElement);
  const pairingSection = required(document, '#pairing', HTMLDetailsElement);
  const pairingForm = required(document, '#pairing-form', HTMLFormElement);
  const serverAddressField = required(document, '#server-address', HTMLInputElement);
  const pairingProblem = required(document, '#pairing-problem', HTMLElement);
  const pairingSignIn = required(document, '#pairing-sign-in', HTMLElement);
  const pairingSignInLink = required(document, '#pairing-sign-in-link', HTMLAnchorElement);
  const pairingSaved = required(document, '#pairing-saved', HTMLElement);
  const pairButton = required(document, '#pair', HTMLButtonElement);

  showServerStatus(
    {
      section: required(document, '#server', HTMLElement),
      status: required(document, '#server-status', HTMLElement),
    },
    dependencies.server.paired,
    dependencies.server.line,
  );

  const pairing = loadPairing(storage);
  const facts: PageFacts = {
    xr: 'checking',
    paired: pairing !== undefined,
    preparation: { state: 'running', fraction: 0 },
    microphone: dependencies.microphone === undefined ? undefined : 'unknown',
    room: 'outside',
  };
  const completedPreparations = new Set<PreparationTask>();

  spatialVoice.checked = loadVoiceFromWhereHeStands(storage);
  serverAddressField.value = loadServerAddress(storage) ?? '';
  if (pairing !== undefined) {
    pairingSaved.textContent = `Paired with ${pairing.address}. Your server starts his conversations.`;
    pairingSaved.hidden = false;
  }
  // Open until the headset is paired, since pairing is the first step; folded away once it is, so the
  // button is the page.
  pairingSection.open = !facts.paired;

  function say(message: string) {
    status.textContent = message;
  }

  function render() {
    const button = primaryButton(facts);
    primary.textContent = button.label;
    primary.disabled = !button.enabled;
    progress.hidden = button.progress === undefined;
    progress.value = button.progress ?? 0;
    sample.disabled = !canOpenWithoutAgent(facts);
    place.disabled = !canOpenWithoutAgent(facts);
    const guidance = microphoneHelp(facts.microphone);
    help.hidden = guidance === undefined;
    help.textContent = guidance ?? '';
  }

  async function prepare() {
    await runPreparation(
      dependencies.preparations,
      (state) => {
        facts.preparation = state;
        if (state.state === 'failed') say(state.problem);
        render();
      },
      completedPreparations,
    );
  }

  async function refreshMicrophone() {
    if (dependencies.microphone === undefined) return;
    facts.microphone = await dependencies.microphone.permission();
    render();
  }

  async function askForMicrophone() {
    const gate = dependencies.microphone;
    if (gate === undefined) return;
    facts.microphone = 'asking';
    render();
    try {
      facts.microphone = await gate.ask();
    } catch (error) {
      facts.microphone = 'prompt';
      say(describe(error));
    }
    render();
  }

  function enterRoom(mode: RoomMode) {
    facts.room = 'entering';
    debug.phase = 'entering';
    debug.problem = null;
    say('Opening your room…');
    render();
    // Asked for here, before anything is awaited, while the click's activation still counts.
    const credentials = mode === 'conversation' ? conversationCredentials(storage) : undefined;
    const room = dependencies.enterRoom(mode, credentials, () => {
      facts.room = 'inside';
      say('');
      render();
    });
    room.then(
      (outcome) => {
        facts.room = 'outside';
        debug.phase = 'ready';
        say(outcome.problem === undefined ? '' : `The last problem in the room: ${outcome.problem}`);
        render();
        // The permission can be taken away from inside the room (the lock icon, a system setting),
        // so it is asked about again rather than remembered.
        void refreshMicrophone();
      },
      (error: unknown) => {
        facts.room = 'outside';
        debug.phase = 'failed';
        debug.problem = describe(error);
        say(`Jarvis could not join you: ${debug.problem}`);
        render();
      },
    );
  }

  primary.addEventListener('click', () => {
    const { action } = primaryButton(facts);
    if (action === 'enter-room') enterRoom('conversation');
    else if (action === 'ask-microphone') void askForMicrophone();
    else if (action === 'retry-preparation') void prepare();
  });

  sample.addEventListener('click', () => {
    if (canOpenWithoutAgent(facts)) enterRoom('sample');
  });

  place.addEventListener('click', () => {
    if (canOpenWithoutAgent(facts)) enterRoom('placement');
  });

  spatialVoice.addEventListener('change', () => {
    const problem = saveVoiceFromWhereHeStands(storage, spatialVoice.checked);
    if (problem !== undefined) say(problem);
  });

  pairingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void pairFromForm();
  });

  async function pairFromForm() {
    pairingProblem.hidden = true;
    pairingSignIn.hidden = true;
    pairButton.disabled = true;
    pairButton.textContent = 'Pairing with your server…';
    const result = await pairWithServer(serverAddressField.value, HEADSET_DEVICE_NAME, dependencies.fetch);
    pairButton.disabled = false;
    pairButton.textContent = 'Pair this headset';
    if ('problem' in result) {
      pairingProblem.textContent = result.problem;
      pairingProblem.hidden = false;
      if (result.signIn !== undefined) {
        pairingSignInLink.href = serverSignInUrl(result.signIn);
        pairingSignIn.hidden = false;
      }
      return;
    }
    const problem = savePairing(storage, result.pairing);
    if (problem !== undefined) {
      pairingProblem.textContent = problem;
      pairingProblem.hidden = false;
      return;
    }
    // The page's line to the server was opened as it loaded, without this token, and perhaps at
    // another address: loaded again, it opens on the paired path with the token.
    dependencies.reload();
  }

  async function checkSupport() {
    const supported = await dependencies.canEnterRoom();
    facts.xr = supported ? 'supported' : 'unsupported';
    debug.phase = supported ? 'ready' : 'unsupported';
    if (!supported) {
      say(
        'This browser cannot put Jarvis in your room. Open this page in the browser on a Meta Quest, or in Chrome on an Android phone with ARCore.',
      );
    }
    render();
  }

  render();
  void checkSupport();
  void refreshMicrophone();
  void prepare();
}
