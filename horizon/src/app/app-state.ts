import { nextSampleMode, readingMilliseconds, SAMPLE_MODE_NAMES, SAMPLE_MODES, type SampleMode } from 'hologram';
import type { Ray } from '../xr/ray';

/**
 * What the headset app is doing, as one pure function from what happened to what to do about it.
 *
 * Everything the room does in answer to the world — the wake word, a trigger pull, a pinch held,
 * the B button, the conversation's phases, the headset's own visibility, the session ending — goes
 * through {@link reduceApp} as an event, and comes out as a new model and a list of effects for
 * the runtime to carry out. Nothing in here touches a session, a renderer or a microphone, so every
 * rule of the product below is pinned by `app-state.spec.ts` without a headset.
 *
 * **The scenes.** On the 2D page Jarvis is `outside`. In the room he is `waiting` for "Hey Jarvis"
 * (nothing drawn), `placing` for the one frame it takes to find him a spot, `present` while the
 * conversation runs through its phases, `failed` while an error hangs where he stands, and
 * `leaving` while he shrinks away. Sample mode has a scene of its own, `sample`, walking the moods.
 *
 * **Dismissing him** is voice first (the agent's own `end_call`), and otherwise a select held for
 * at least 0.8 s or the B/Y button — never a short select, because hands pinch by accident while
 * people talk, and a conversation that ended every time someone gestured would be unusable. A
 * select while he is leaving is the opposite mistake corrected: it cancels the fade and summons
 * him again where he was.
 *
 * **Failures** are never silent and never permanent. The problem is shown on a panel at his spot
 * for as long as it takes to read (at least six seconds), or until a select, and then he leaves
 * and the wake word is armed again — so one bad summon never leaves the room deaf. The problem is
 * also handed back to the 2D page, which shows it after the room is closed.
 *
 * **The headset's lifecycle** follows one table. `visible-blurred` (the Meta button, the system
 * keyboard) keeps the call and ignores the wake word and selects; a minute of it ends the call.
 * `hidden` ends the call quietly and disarms. Coming back to `visible` checks the wake engine's
 * health before arming. The session ending hangs up, stops the microphone and puts the page back.
 * The document's own visibility is never consulted while a session exists: what Quest does with it
 * during an immersive session is not specified.
 */

/** A conversation's phase, as `JarvisSession` reports it (`src/conversation/`). */
export type SessionPhase = 'idle' | 'greeting' | 'connecting' | 'live' | 'ended' | 'failed';

/** The XR session's visibility state. */
export type XrVisibility = 'visible' | 'visible-blurred' | 'hidden';

/** Which room the page opened: the real one with a conversation, or sample mode (no key, no microphone). */
export type RoomMode = 'conversation' | 'sample';

/** What is being summoned while a spot is found: a conversation, or sample mode's first mood. */
export type PlacingPurpose = 'conversation' | 'sample';

/** Where the app is. See the file comment for what each means. */
export type Scene =
  | { kind: 'outside' }
  | { kind: 'waiting' }
  | { kind: 'placing'; purpose: PlacingPurpose; towards: Ray | undefined }
  | { kind: 'present'; sessionPhase: SessionPhase }
  | { kind: 'failed'; problem: string; until: number }
  | { kind: 'leaving'; afterwards: 'wait' | 'exit' }
  | { kind: 'sample'; mode: SampleMode };

/**
 * What the wake engine last said about itself.
 *
 * `absent` is a room with no wake engine at all — Milestone 0, before `src/wake/` is wired in —
 * which shows neither the hint nor a status line, because there is nothing to report on.
 */
export type WakeReadiness = { kind: 'absent' } | { kind: 'listening' } | { kind: 'not-listening'; problem: string };

/** How long a select must be held to count as the hang-up gesture, in seconds. */
export const HANG_UP_HOLD_SECONDS = 0.8;

/**
 * How long the room stays blurred before the call is ended, in milliseconds.
 *
 * A minute: long enough to glance at a notification or answer the Meta menu's "resume?" without
 * losing him, short enough that a headset left on a desk mid-sentence stops paying for a call
 * nobody is on.
 */
export const BLURRED_CALL_LIMIT_MS = 60_000;

/** The least time an error panel stays up, in milliseconds, however short the problem. */
export const SHORTEST_ERROR_MS = 6000;

/** How long a sample mood's name stays up after a select changes it, in milliseconds. */
export const TOAST_MS = 1800;

/** What an error panel says when the conversation failed without saying why. */
export const UNEXPLAINED_FAILURE = 'Jarvis could not be reached.';

/** The hint, shown in the empty room until he has been summoned once. */
export const HINT_LINES: readonly string[] = ['Say “Hey Jarvis”', 'or pinch / pull the trigger'];

/** The first line of the status shown whenever the wake engine is not listening; the second is its problem. */
export const NOT_LISTENING_LINE = 'Not listening for “Hey Jarvis”';

export interface AppModel {
  scene: Scene;
  /** Fixed for one XR session; meaningless outside. */
  mode: RoomMode;
  visibility: XrVisibility;
  /** When the room last became blurred, while that is being counted; undefined otherwise. */
  blurredSince: number | undefined;
  wake: WakeReadiness;
  /** Set on coming back to visible, until the wake engine reports its health: nothing is armed until then. */
  checkingWake: boolean;
  /** Whether he has been summoned in this session: the hint only teaches, it does not nag. */
  summonedOnce: boolean;
  /** Whether this headset shows its system keyboard to an immersive page. */
  canType: boolean;
  keyboardOpen: boolean;
  /** His latest line in writing, while he is present. */
  caption: string | undefined;
  /** A problem reported by the conversation, waiting for the `failed` phase that always follows it. */
  pendingProblem: string | undefined;
  /** Sample mode's mood name, until it fades. */
  toast: { text: string; until: number } | undefined;
}

/** A select, already told apart by how long it was held and what its ray hit. */
export interface SelectEvent {
  type: 'select';
  hold: 'short' | 'long';
  target: 'him' | 'keyboard' | 'elsewhere';
  /** The ray it was made along, when there was a pose for it: a summon faces him that way. */
  ray?: Ray;
}

export type AppEvent =
  | {
      type: 'entered';
      mode: RoomMode;
      /** Summon at once rather than wait for the wake word — the room when there is no wake engine to wait on. */
      summonNow?: boolean;
      /** Whether the session can show the system keyboard (`XRSession.isSystemKeyboardSupported`). */
      canType?: boolean;
    }
  | { type: 'wake' }
  | SelectEvent
  | { type: 'dismiss-button' }
  | { type: 'placed' }
  | { type: 'session-phase'; phase: SessionPhase }
  | { type: 'problem'; message: string }
  | { type: 'caption'; text: string | undefined }
  | { type: 'presence-gone' }
  | { type: 'visibility'; state: XrVisibility }
  | { type: 'tick' }
  | { type: 'session-ended' }
  | { type: 'wake-health'; readiness: WakeReadiness }
  | { type: 'keyboard-closed' }
  | { type: 'typed'; text: string };

/** The 3D panels the room can show. */
export type PanelName = 'hint' | 'status' | 'error' | 'toast' | 'caption' | 'keyboard' | 'readout';

/**
 * What the room looks like in a model, derived rather than stored so it can never disagree with
 * the scene. The runtime is told about it only through the effects its changes produce.
 */
export interface AppView {
  hologram: 'hidden' | 'shown' | 'leaving';
  /**
   * Each panel's lines, or null when it is hidden. The keyboard glyph and the frame-rate readout
   * have no lines of their own here — an empty list only says they are shown; the readout's text
   * is measured by the runtime.
   */
  panels: Record<PanelName, readonly string[] | null>;
  /** Undefined outside the room, where there is no session to ask. */
  frameRate: 'lowest' | 'highest' | undefined;
  wakeArmed: boolean;
}

export type AppEffect =
  | { type: 'place'; towards: Ray | undefined }
  | { type: 'arrive' }
  | { type: 'summon' }
  | { type: 'hang-up' }
  | { type: 'end-quietly' }
  | { type: 'arm-wake' }
  | { type: 'disarm-wake' }
  | { type: 'check-wake' }
  | { type: 'hologram'; state: AppView['hologram'] }
  | { type: 'show-panel'; panel: PanelName; lines: readonly string[] }
  | { type: 'hide-panel'; panel: PanelName }
  | { type: 'set-frame-rate'; target: 'lowest' | 'highest' }
  | { type: 'start-sample'; mode: SampleMode }
  | { type: 'cycle-sample'; mode: SampleMode }
  | { type: 'stop-sample' }
  | { type: 'open-keyboard' }
  | { type: 'close-keyboard' }
  | { type: 'set-typing'; typing: boolean }
  | { type: 'send-text'; text: string }
  | { type: 'remember-problem'; message: string }
  | { type: 'stop-microphone' }
  | { type: 'exit-xr' }
  | { type: 'return-to-page' };

export interface AppStep {
  model: AppModel;
  effects: AppEffect[];
}

/** The app on the 2D page, before any room has been opened. */
export function initialAppModel(wake: WakeReadiness = { kind: 'absent' }): AppModel {
  return {
    scene: { kind: 'outside' },
    mode: 'conversation',
    visibility: 'visible',
    blurredSince: undefined,
    wake,
    checkingWake: false,
    summonedOnce: false,
    canType: false,
    keyboardOpen: false,
    caption: undefined,
    pendingProblem: undefined,
    toast: undefined,
  };
}

/** A handler's answer before the view is compared: the next model, and the commands it gave. */
interface Transition {
  model: AppModel;
  commands: AppEffect[];
}

function stay(model: AppModel): Transition {
  return { model, commands: [] };
}

function go(model: AppModel, changes: Partial<AppModel>, ...commands: AppEffect[]): Transition {
  return { model: { ...model, ...changes }, commands };
}

/** Whether wake detections and selects count: only in a room the user is actually looking at. */
function attending(model: AppModel): boolean {
  return model.visibility === 'visible';
}

/** A spot is being found for him, facing along `towards` when a select summoned him. */
function startPlacing(model: AppModel, towards: Ray | undefined): Transition {
  return go(
    model,
    { scene: { kind: 'placing', purpose: 'conversation', towards }, summonedOnce: true },
    { type: 'place', towards },
  );
}

/** Back from leaving without a new spot: the fade is cancelled where he stands, and he is summoned again. */
function summonAgain(model: AppModel): Transition {
  return go(
    model,
    { scene: { kind: 'present', sessionPhase: 'idle' }, summonedOnce: true },
    { type: 'arrive' },
    { type: 'summon' },
  );
}

/** He goes, and when he has gone the room waits for the wake word again. */
function leaveToWait(model: AppModel, ...commands: AppEffect[]): Transition {
  return go(model, { scene: { kind: 'leaving', afterwards: 'wait' } }, ...commands);
}

/** He goes, and when he has gone the room closes — how sample mode ends. */
function leaveToExit(model: AppModel): Transition {
  return go(model, { scene: { kind: 'leaving', afterwards: 'exit' } });
}

function onEntered(model: AppModel, event: Extract<AppEvent, { type: 'entered' }>): Transition {
  const fresh: AppModel = {
    ...initialAppModel(model.wake),
    mode: event.mode,
    canType: event.canType ?? false,
    scene: { kind: 'waiting' },
  };
  if (event.mode === 'sample') {
    return go(
      fresh,
      { scene: { kind: 'placing', purpose: 'sample', towards: undefined } },
      { type: 'place', towards: undefined },
    );
  }
  return event.summonNow ? startPlacing(fresh, undefined) : stay(fresh);
}

function onWake(model: AppModel): Transition {
  // Not armed, so a detection that arrives anyway is one the engine was already on its way to
  // sending: blurred, in sample mode, or before its health has been checked on coming back.
  if (!attending(model) || model.mode !== 'conversation' || model.checkingWake) return stay(model);
  if (model.scene.kind === 'waiting') return startPlacing(model, undefined);
  if (model.scene.kind === 'leaving' && model.scene.afterwards === 'wait') return summonAgain(model);
  return stay(model);
}

function selectInSample(model: AppModel, event: SelectEvent, mode: SampleMode, now: number): Transition {
  if (event.hold === 'short' && event.target === 'him') {
    const next = nextSampleMode(mode);
    return go(
      model,
      { scene: { kind: 'sample', mode: next }, toast: { text: SAMPLE_MODE_NAMES[next], until: now + TOAST_MS } },
      { type: 'cycle-sample', mode: next },
    );
  }
  // Anywhere else — or held, or the B button — is the way out, as tapping beside him is on the phone.
  return leaveToExit(model);
}

function selectWhilePresent(model: AppModel, event: SelectEvent, sessionPhase: SessionPhase): Transition {
  if (event.hold === 'long') return leaveToWait(model, { type: 'hang-up' });
  if (event.target === 'keyboard' && sessionPhase === 'live' && model.canType && !model.keyboardOpen) {
    // The system keyboard blurs the room while it is up, and the minute's grace is not counted
    // against someone typing.
    return go(
      model,
      { keyboardOpen: true, blurredSince: undefined },
      { type: 'open-keyboard' },
      { type: 'set-typing', typing: true },
    );
  }
  // A short select during a call does nothing: it is far more often a gesture than a request.
  return stay(model);
}

function onSelect(model: AppModel, event: SelectEvent, now: number): Transition {
  if (!attending(model)) return stay(model);
  const { scene } = model;
  switch (scene.kind) {
    case 'waiting':
      return startPlacing(model, event.ray);
    case 'present':
      return selectWhilePresent(model, event, scene.sessionPhase);
    case 'failed':
      return leaveToWait(model);
    case 'leaving':
      return scene.afterwards === 'wait' && event.hold === 'short' ? summonAgain(model) : stay(model);
    case 'sample':
      return selectInSample(model, event, scene.mode, now);
    default:
      return stay(model);
  }
}

function onDismissButton(model: AppModel): Transition {
  if (!attending(model)) return stay(model);
  switch (model.scene.kind) {
    case 'present':
      return leaveToWait(model, { type: 'hang-up' });
    case 'failed':
      return leaveToWait(model);
    case 'sample':
      return leaveToExit(model);
    default:
      return stay(model);
  }
}

function onPlaced(model: AppModel): Transition {
  if (model.scene.kind !== 'placing') return stay(model);
  if (model.scene.purpose === 'sample') {
    const mode = SAMPLE_MODES[0];
    return go(model, { scene: { kind: 'sample', mode } }, { type: 'arrive' }, { type: 'start-sample', mode });
  }
  return go(model, { scene: { kind: 'present', sessionPhase: 'idle' } }, { type: 'arrive' }, { type: 'summon' });
}

function onSessionPhase(model: AppModel, phase: SessionPhase, now: number): Transition {
  if (model.scene.kind !== 'present') return stay(model);
  if (phase === 'failed') {
    const problem = model.pendingProblem ?? UNEXPLAINED_FAILURE;
    const until = now + Math.max(SHORTEST_ERROR_MS, readingMilliseconds(problem));
    return go(
      model,
      { scene: { kind: 'failed', problem, until }, pendingProblem: undefined },
      { type: 'remember-problem', message: problem },
    );
  }
  if (phase === 'ended') return leaveToWait(model);
  return go(model, { scene: { kind: 'present', sessionPhase: phase } });
}

function onProblem(model: AppModel, message: string): Transition {
  return model.scene.kind === 'present' ? go(model, { pendingProblem: message }) : stay(model);
}

function onCaption(model: AppModel, text: string | undefined): Transition {
  return model.scene.kind === 'present' ? go(model, { caption: text }) : stay(model);
}

function onPresenceGone(model: AppModel): Transition {
  if (model.scene.kind !== 'leaving') return stay(model);
  if (model.scene.afterwards === 'wait') return go(model, { scene: { kind: 'waiting' } });
  return go(model, { scene: { kind: 'outside' } }, { type: 'stop-sample' }, { type: 'exit-xr' });
}

/** Whether a conversation may be open: the ones `hidden` and the blurred minute have to end. */
function mayHaveCall(scene: Scene): boolean {
  return scene.kind === 'present';
}

function onHidden(model: AppModel): Transition {
  const changes: Partial<AppModel> = { visibility: 'hidden', blurredSince: undefined };
  if (model.mode !== 'conversation') return go(model, changes);
  const busy = ['placing', 'present', 'failed', 'leaving'].includes(model.scene.kind);
  if (!busy) return go(model, changes);
  // Nothing is drawn while hidden, so there is no fade to watch: he is simply gone when the user
  // comes back. Quietly, so a disconnect that the ending itself causes is not shown as a failure.
  const commands: AppEffect[] = mayHaveCall(model.scene) ? [{ type: 'end-quietly' }] : [];
  return go(model, { ...changes, scene: { kind: 'waiting' } }, ...commands);
}

function onVisibility(model: AppModel, state: XrVisibility, now: number): Transition {
  if (state === model.visibility || model.scene.kind === 'outside') return go(model, { visibility: state });
  if (state === 'hidden') return onHidden(model);
  if (state === 'visible-blurred') {
    return go(model, { visibility: state, blurredSince: model.keyboardOpen ? undefined : now });
  }
  // Back in view. The microphone may have been taken while the room was away — by the Meta menu,
  // by "Hey Meta", by the headset sleeping — so the wake engine is asked how it is before anything
  // is armed again.
  if (model.mode !== 'conversation' || model.wake.kind === 'absent') {
    return go(model, { visibility: state, blurredSince: undefined });
  }
  return go(model, { visibility: state, blurredSince: undefined, checkingWake: true }, { type: 'check-wake' });
}

function blurredTooLong(model: AppModel, now: number): boolean {
  return (
    model.visibility === 'visible-blurred' &&
    model.blurredSince !== undefined &&
    !model.keyboardOpen &&
    now - model.blurredSince >= BLURRED_CALL_LIMIT_MS
  );
}

function onTick(model: AppModel, now: number): Transition {
  if (model.scene.kind === 'failed' && now >= model.scene.until) return leaveToWait(model);
  if (model.toast !== undefined && now >= model.toast.until) return go(model, { toast: undefined });
  if (blurredTooLong(model, now)) {
    const changes: Partial<AppModel> = { blurredSince: undefined };
    return mayHaveCall(model.scene)
      ? go(model, { ...changes, scene: { kind: 'leaving', afterwards: 'wait' } }, { type: 'end-quietly' })
      : go(model, changes);
  }
  return stay(model);
}

function onSessionEnded(model: AppModel): Transition {
  const commands: AppEffect[] = [];
  if (model.mode === 'conversation') {
    if (mayHaveCall(model.scene) || model.scene.kind === 'placing') commands.push({ type: 'hang-up' });
    commands.push({ type: 'stop-microphone' });
  } else if (model.scene.kind !== 'outside') {
    commands.push({ type: 'stop-sample' });
  }
  commands.push({ type: 'return-to-page' });
  return go(model, { scene: { kind: 'outside' }, visibility: 'visible', blurredSince: undefined }, ...commands);
}

function onWakeHealth(model: AppModel, readiness: WakeReadiness): Transition {
  return go(model, { wake: readiness, checkingWake: false });
}

function onKeyboardClosed(model: AppModel, now: number): Transition {
  if (!model.keyboardOpen) return stay(model);
  // Still blurred once the keyboard is down means the room is away for some other reason, which
  // is counted from now.
  const blurredSince = model.visibility === 'visible-blurred' ? now : undefined;
  return go(model, { keyboardOpen: false, blurredSince }, { type: 'set-typing', typing: false });
}

function onTyped(model: AppModel, text: string): Transition {
  const live = model.scene.kind === 'present' && model.scene.sessionPhase === 'live';
  return live && text.trim() ? go(model, {}, { type: 'send-text', text: text.trim() }) : stay(model);
}

function handle(model: AppModel, event: AppEvent, now: number): Transition {
  switch (event.type) {
    case 'entered':
      return onEntered(model, event);
    case 'wake':
      return onWake(model);
    case 'select':
      return onSelect(model, event, now);
    case 'dismiss-button':
      return onDismissButton(model);
    case 'placed':
      return onPlaced(model);
    case 'session-phase':
      return onSessionPhase(model, event.phase, now);
    case 'problem':
      return onProblem(model, event.message);
    case 'caption':
      return onCaption(model, event.text);
    case 'presence-gone':
      return onPresenceGone(model);
    case 'visibility':
      return onVisibility(model, event.state, now);
    case 'tick':
      return onTick(model, now);
    case 'session-ended':
      return onSessionEnded(model);
    case 'wake-health':
      return onWakeHealth(model, event.readiness);
    case 'keyboard-closed':
      return onKeyboardClosed(model, now);
    case 'typed':
      return onTyped(model, event.text);
  }
}

/**
 * What every scene change owes the keyboard and the caption, whichever event caused it: the
 * keyboard is put away once the conversation it was typing into is no longer live, and his line is
 * forgotten once he is no longer there to have said it.
 */
function tidy(transition: Transition): Transition {
  let { model } = transition;
  const commands = [...transition.commands];
  const live = model.scene.kind === 'present' && model.scene.sessionPhase === 'live';
  if (model.keyboardOpen && !live) {
    model = { ...model, keyboardOpen: false };
    commands.push({ type: 'close-keyboard' }, { type: 'set-typing', typing: false });
  }
  if (model.caption !== undefined && model.scene.kind !== 'present') {
    model = { ...model, caption: undefined };
  }
  if (model.pendingProblem !== undefined && model.scene.kind !== 'present') {
    model = { ...model, pendingProblem: undefined };
  }
  return { model, commands };
}

function hologramOf(scene: Scene): AppView['hologram'] {
  switch (scene.kind) {
    case 'present':
    case 'failed':
    case 'sample':
      return 'shown';
    case 'leaving':
      return 'leaving';
    default:
      return 'hidden';
  }
}

function hintOf(model: AppModel): readonly string[] | null {
  const shown =
    model.scene.kind === 'waiting' &&
    attending(model) &&
    !model.checkingWake &&
    model.wake.kind === 'listening' &&
    !model.summonedOnce;
  return shown ? HINT_LINES : null;
}

function statusOf(model: AppModel): readonly string[] | null {
  if (model.scene.kind !== 'waiting' || model.wake.kind !== 'not-listening') return null;
  return [NOT_LISTENING_LINE, model.wake.problem];
}

function keyboardOf(model: AppModel): readonly string[] | null {
  const live = model.scene.kind === 'present' && model.scene.sessionPhase === 'live';
  return live && model.canType && !model.keyboardOpen && attending(model) ? [] : null;
}

function panelsOf(model: AppModel): AppView['panels'] {
  const { scene } = model;
  return {
    hint: hintOf(model),
    status: statusOf(model),
    error: scene.kind === 'failed' ? [scene.problem] : null,
    toast: scene.kind === 'sample' && model.toast !== undefined ? [model.toast.text] : null,
    caption: scene.kind === 'present' && model.caption !== undefined ? [model.caption] : null,
    keyboard: keyboardOf(model),
    readout: scene.kind === 'sample' ? [] : null,
  };
}

function wakeArmedOf(model: AppModel): boolean {
  const { scene } = model;
  const waitingForIt = scene.kind === 'waiting' || (scene.kind === 'leaving' && scene.afterwards === 'wait');
  return (
    model.mode === 'conversation' &&
    model.wake.kind !== 'absent' &&
    waitingForIt &&
    attending(model) &&
    !model.checkingWake
  );
}

/** What the room looks like in `model`. */
export function viewOf(model: AppModel): AppView {
  const outside = model.scene.kind === 'outside';
  return {
    hologram: hologramOf(model.scene),
    panels: panelsOf(model),
    // Nothing to draw while waiting, so the headset is asked for as few frames as it will give;
    // the moment he is on his way it is asked for as many as it will (up to 90).
    frameRate: outside ? undefined : model.scene.kind === 'waiting' ? 'lowest' : 'highest',
    wakeArmed: wakeArmedOf(model),
  };
}

const PANEL_NAMES: readonly PanelName[] = ['hint', 'status', 'error', 'toast', 'caption', 'keyboard', 'readout'];

function sameLines(before: readonly string[] | null, after: readonly string[] | null): boolean {
  if (before === null || after === null) return before === after;
  return before.length === after.length && before.every((line, index) => line === after[index]);
}

/** The effects that bring a room showing `before` to showing `after`. */
export function viewChanges(before: AppView, after: AppView): AppEffect[] {
  const effects: AppEffect[] = [];
  if (before.hologram !== after.hologram) effects.push({ type: 'hologram', state: after.hologram });
  for (const panel of PANEL_NAMES) {
    const lines = after.panels[panel];
    if (sameLines(before.panels[panel], lines)) continue;
    effects.push(lines === null ? { type: 'hide-panel', panel } : { type: 'show-panel', panel, lines });
  }
  if (after.frameRate !== undefined && after.frameRate !== before.frameRate) {
    effects.push({ type: 'set-frame-rate', target: after.frameRate });
  }
  if (before.wakeArmed !== after.wakeArmed) effects.push({ type: after.wakeArmed ? 'arm-wake' : 'disarm-wake' });
  return effects;
}

/**
 * The app's one transition: the model after `event`, which happened at `now` (milliseconds on
 * any steady clock — the runtime uses `performance.now()`), and the effects to carry out, in order.
 *
 * Commands the event gave come first, then whatever the change in what the room shows implies —
 * panels, the hologram's visibility, the frame rate and whether the wake word is armed — worked out
 * by comparing the view before and after, so no handler has to remember them.
 */
export function reduceApp(model: AppModel, event: AppEvent, now: number): AppStep {
  const transition = tidy(handle(model, event, now));
  return {
    model: transition.model,
    effects: [...transition.commands, ...viewChanges(viewOf(model), viewOf(transition.model))],
  };
}
