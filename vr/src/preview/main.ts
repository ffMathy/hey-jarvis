import { loadPainter } from '../hologram3d';
import { canEnterRoom, requestRoomSession } from '../xr/room-session';
import type { HologramPreviewHook, PreviewBackground, PreviewMode, PreviewPhase } from './preview-hook';
import { PREVIEW_PHASES } from './preview-hook';
import { createPreviewRoom } from './room';
import { createStage, type StageView } from './stage';

/**
 * The preview page: Jarvis in three dimensions on a desktop canvas, going through every phase,
 * and in a headset's room from the same page.
 *
 * It is how he can be looked at without a Quest, and what the browser tests photograph and
 * measure through `window.__hologramPreview`. `?flat` starts it on the phone's flat drawing.
 */

function required<Found extends Element>(selector: string, kind: new () => Found): Found {
  const element = document.querySelector(selector);
  if (!(element instanceof kind)) throw new Error(`The page has no ${selector}.`);
  return element;
}

const canvas = required('#view', HTMLCanvasElement);
const stageElement = required('#stage', HTMLElement);
const readout = required('#readout', HTMLElement);
const alphaInput = required('#alpha', HTMLInputElement);
const alphaValue = required('#alpha-value', HTMLOutputElement);
const enterButton = required('#enter-room', HTMLButtonElement);

/** Marks the button in `group` whose data attribute is `value` as the pressed one. */
function press(attribute: string, value: string) {
  for (const button of document.querySelectorAll<HTMLButtonElement>(`button[data-${attribute}]`)) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
  }
}

/** Calls `handle` with the value of whichever button carrying `attribute` is clicked. */
function onButtons(attribute: string, handle: (value: string) => void) {
  for (const button of document.querySelectorAll<HTMLButtonElement>(`button[data-${attribute}]`)) {
    button.addEventListener('click', () => {
      const value = button.dataset[attribute];
      if (value === undefined) return;
      press(attribute, value);
      handle(value);
    });
  }
}

function isPhase(value: string): value is PreviewPhase {
  return PREVIEW_PHASES.some((phase) => phase === value);
}

function isMode(value: string): value is PreviewMode {
  return value === 'volumetric' || value === 'flat';
}

function isView(value: string): value is StageView {
  return value === 'front' || value === 'side' || value === 'orbit';
}

function setBackground(background: PreviewBackground) {
  stageElement.dataset.background = background;
  press('background', background);
}

async function start(): Promise<HologramPreviewHook> {
  const painter = await loadPainter(new URL('vendor/', document.baseURI));
  const stage = await createStage(canvas, painter);
  const room = createPreviewRoom(painter);
  const initialMode: PreviewMode = new URLSearchParams(location.search).has('flat') ? 'flat' : 'volumetric';

  onButtons('phase', (value) => {
    if (!isPhase(value)) return;
    stage.setPhase(value);
    room.setPhase(value);
  });
  onButtons('mode', (value) => {
    if (!isMode(value)) return;
    stage.setMode(value);
    room.setMode(value);
  });
  onButtons('background', (value) => setBackground(value === 'grey' ? 'grey' : 'black'));
  onButtons('view', (value) => {
    if (isView(value)) stage.setView(value);
  });
  alphaInput.addEventListener('input', () => {
    const share = Number(alphaInput.value);
    alphaValue.value = share.toFixed(2);
    stage.setAlphaFactor(share);
    room.setAlphaFactor(share);
  });

  enterButton.addEventListener('click', () => {
    const xr = navigator.xr;
    if (xr === undefined) return;
    enterButton.disabled = true;
    stage.pause();
    // Asked for before anything is awaited, while the click still counts as a user's.
    requestRoomSession(xr)
      .then((session) => room.enter(session))
      .catch((error: unknown) => {
        readout.textContent = `The room would not open: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        enterButton.disabled = false;
        stage.resume();
      });
  });
  canEnterRoom(navigator.xr).then((can) => {
    enterButton.disabled = !can;
  });

  stage.setMode(initialMode);
  press('mode', initialMode);
  press('phase', stage.phase);
  press('view', 'front');
  setBackground('black');
  stage.resume();

  window.setInterval(() => {
    const { diagnostics, frame } = stage.hologram;
    readout.textContent = [
      `update ${diagnostics.cpuMilliseconds.toFixed(1)} ms`,
      `CanvasKit ${diagnostics.canvasKitMilliseconds.toFixed(1)} ms`,
      `${Math.round(diagnostics.density * 100)}% of the particles`,
      frame === null ? '' : `${frame.time.toFixed(1)} s in`,
    ]
      .filter((part) => part !== '')
      .join(' · ');
  }, 500);

  return {
    ready: Promise.resolve(),
    async show(request) {
      setBackground(request.background);
      press('phase', request.phase);
      press('mode', request.mode);
      return stage.still(request);
    },
    async checkPort(request) {
      return stage.checkPort(request);
    },
    stereo(request, separation) {
      setBackground(request.background);
      return stage.stereo(request, separation);
    },
    setRoomPhase(phase, holdAtSeconds) {
      room.setPhase(phase, holdAtSeconds);
    },
    get room() {
      return room.status();
    },
  };
}

/** What the room reports before the preview has loaded. */
const NOT_IN_ROOM: HologramPreviewHook['room'] = {
  frames: 0,
  intervals: [],
  updates: [],
  canvasKit: [],
  entered: false,
  phase: 'greeting',
  secondsIntoPhase: 0,
  placedAt: null,
  headAtPlacement: null,
};

const starting = start();
// Published at once, so a test can wait on `ready` from its first line.
window.__hologramPreview = {
  ready: starting.then(() => undefined),
  show: (request) => starting.then((hook) => hook.show(request)),
  checkPort: (request) => starting.then((hook) => hook.checkPort(request)),
  stereo: (request, separation) => starting.then((hook) => hook.stereo(request, separation)),
  setRoomPhase: (phase, holdAtSeconds) => {
    starting.then((hook) => hook.setRoomPhase(phase, holdAtSeconds));
  },
  get room() {
    return NOT_IN_ROOM;
  },
};
starting.then((hook) => {
  window.__hologramPreview = hook;
});
starting.catch((error: unknown) => {
  readout.textContent = `Jarvis could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
});
