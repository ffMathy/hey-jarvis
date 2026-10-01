import type { ElevenLabsSettings, ServerLink } from 'hologram';
import type { JarvisDebugState } from '../debug-hook';
import type { MicrophoneGate } from './microphone';
import { type PreparationTask, runPreparation } from './preparation';
import { canOpenWithoutAgent, microphoneHelp, type PageFacts, primaryButton } from './prerequisites';
import { showServerStatus } from './server-status';
import { checkSettings, type KeyValueStorage, loadSettings, saveSettings } from './settings';
import { loadVoiceFromWhereHeStands, saveVoiceFromWhereHeStands } from './voice-setting';

/**
 * The 2D page: the one place a headset session can start from — entering an immersive session
 * needs a click — and the place you come back to when it ends.
 *
 * Plain DOM over the markup in `index.html`. What the big button says comes from
 * `prerequisites.ts`; this file keeps the facts it is worked out from current and draws the result:
 * whether this browser can open a room, whether there are settings, how far getting ready has got,
 * the microphone permission, and whether the user is in the room. It also owns the settings form,
 * the "His voice from where he stands" switch (`voice-setting.ts`, read again on every Enter), and
 * the status line, which after a room closes says what went wrong in it, if anything did. Beside the
 * way into the real room are two that need no key and no microphone: sample mode, and placing the
 * things Jarvis works on in the room.
 */

/** Which room to open: the real one, sample mode, or one to place things in. */
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
  enterRoom(mode: RoomMode, settings: ElevenLabsSettings | undefined, onInside: () => void): Promise<RoomOutcome>;
  /**
   * The page's line to sir's Jarvis server and its address, for the page to say whether it is
   * connected and offer signing in to it when it is not (`server-status.ts`).
   */
  server: { address: string | undefined; line: Pick<ServerLink, 'onConnectionChange'> };
  debug: JarvisDebugState;
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
  const settingsSection = required(document, '#settings', HTMLDetailsElement);
  const form = required(document, '#settings-form', HTMLFormElement);
  const apiKeyField = required(document, '#api-key', HTMLInputElement);
  const showKey = required(document, '#show-key', HTMLButtonElement);
  const agentIdField = required(document, '#agent-id', HTMLInputElement);
  const settingsProblem = required(document, '#settings-problem', HTMLElement);
  const settingsSaved = required(document, '#settings-saved', HTMLElement);
  const saveButton = required(document, '#save-settings', HTMLButtonElement);
  const spatialVoice = required(document, '#spatial-voice', HTMLInputElement);

  showServerStatus(
    {
      section: required(document, '#server', HTMLElement),
      status: required(document, '#server-status', HTMLElement),
      signIn: required(document, '#server-sign-in', HTMLElement),
      signInLink: required(document, '#server-sign-in-link', HTMLAnchorElement),
    },
    dependencies.server.address,
    dependencies.server.line,
  );

  const stored = loadSettings(storage);
  const facts: PageFacts = {
    xr: 'checking',
    hasSettings: stored !== undefined,
    preparation: { state: 'running', fraction: 0 },
    microphone: dependencies.microphone === undefined ? undefined : 'unknown',
    room: 'outside',
  };
  const completedPreparations = new Set<PreparationTask>();

  spatialVoice.checked = loadVoiceFromWhereHeStands(storage);
  apiKeyField.value = stored?.apiKey ?? '';
  agentIdField.value = stored?.agentId ?? '';
  // Open when there is something to fill in; folded away once there is not, so the button is the page.
  settingsSection.open = stored === undefined;

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
    const room = dependencies.enterRoom(mode, mode === 'conversation' ? loadSettings(storage) : undefined, () => {
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

  showKey.addEventListener('click', () => {
    const showing = apiKeyField.type === 'text';
    apiKeyField.type = showing ? 'password' : 'text';
    showKey.textContent = showing ? 'Show' : 'Hide';
    showKey.setAttribute('aria-pressed', String(!showing));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveFromForm();
  });

  async function saveFromForm() {
    settingsProblem.hidden = true;
    settingsSaved.hidden = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Checking with ElevenLabs…';
    const result = await checkSettings(apiKeyField.value, agentIdField.value, dependencies.fetch);
    saveButton.disabled = false;
    saveButton.textContent = 'Check and save';
    const problem = 'problem' in result ? result.problem : saveSettings(storage, result.settings);
    if (problem !== undefined) {
      settingsProblem.textContent = problem;
      settingsProblem.hidden = false;
      return;
    }
    settingsSaved.textContent = 'Saved. ElevenLabs accepted the key and found the agent.';
    settingsSaved.hidden = false;
    facts.hasSettings = true;
    render();
  }

  async function checkSupport() {
    const supported = await dependencies.canEnterRoom();
    facts.xr = supported ? 'supported' : 'unsupported';
    debug.phase = supported ? 'ready' : 'unsupported';
    if (!supported) {
      say('This browser cannot put Jarvis in your room. Open this page in the browser on a Meta Quest.');
    }
    render();
  }

  render();
  void checkSupport();
  void refreshMicrophone();
  void prepare();
}
