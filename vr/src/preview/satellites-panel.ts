import {
  type AgentActivity,
  type AgentActivityState,
  type AgentWorkState,
  agentActivityOf,
  analyseFrame,
  createHologramScene,
  NO_WORK,
  pictureSceneOf,
  recordActivity,
  type SatelliteOrbit,
  SCENE_SEED,
  SILENT_VOICE,
  satelliteOrbits,
  stepWork,
} from 'hologram';
import { createGpuPicture, drawGpuPicture } from 'hologram/gpu';
import { AGENT_GLYPHS } from '../../../mcp/mastra/verticals/agent-glyphs';
import type { RoomSatellites } from '../app/room-satellites';
import type { HologramDrive } from '../hologram3d';
import { createFrameClock } from '../hologram3d/frame-clock';

/**
 * The preview's satellites panel: every agent's glyph, as its vertical on the server declares it
 * (`mcp/mastra/verticals/agent-glyphs.ts` — files that import nothing, read here at build time, so
 * the page needs no server), to set to work round him and watch both ways they are drawn: in 3D on
 * the stage, as the headset draws them, and flat beside it, as the phone and its web build do
 * (`hologram/gpu`'s picture, over him at rest). A path of your own can be tried in the same
 * way, and is read as strictly as one from the server.
 *
 * Everything goes through `agentActivity` messages, built here as routing would send them, so what
 * is shown is what a real request would show.
 */

/** One agent the panel can set to work: its id and glyph, and its delegation while at work. */
interface PanelAgent {
  agentId: string;
  glyph: string;
  delegationId: string | undefined;
}

export interface SatellitesPanel {
  /** Each satellite's agent and status, as the stage has them, for the browser tests. */
  report(): { agentId: string; status: string }[];
}

function required<Found extends Element>(selector: string, kind: new () => Found): Found {
  const element = document.querySelector(selector);
  if (!(element instanceof kind)) throw new Error(`The page has no ${selector}.`);
  return element;
}

/** A small picture of `glyph` for its button, stroked as the atlas strokes it (`glyph-atlas.ts`). */
function glyphIcon(glyph: string): HTMLCanvasElement {
  const icon = document.createElement('canvas');
  const size = 40;
  icon.width = size * 2;
  icon.height = size * 2;
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  const context = icon.getContext('2d');
  if (context !== null) {
    context.setTransform(size / 1.15, 0, 0, size / 1.15, size, size);
    context.lineWidth = 0.15;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#ff7e28';
    context.stroke(new Path2D(glyph));
  }
  return icon;
}

/** Him with no voice, as the phone shows him between words, so the satellites have him to go round. */
const AT_REST: HologramDrive = { voice: SILENT_VOICE, thinking: false, leaving: false };

/**
 * The flat view: the satellites as the phone draws them, over the phone's picture of him at rest,
 * with `hologram/gpu`'s picture on a WebGL 2 canvas of its own — the very calls the phone makes,
 * cleared as it clears — every frame.
 */
function startPhoneView(canvas: HTMLCanvasElement, orbits: () => SatelliteOrbit[]) {
  // The picture needs a depth and a stencil buffer (`gpu-picture.ts`), as the phone's canvas has.
  const gl = canvas.getContext('webgl2', { depth: true, stencil: true, premultipliedAlpha: true });
  if (gl === null) throw new Error('There is no WebGL 2 context for the phone view.');
  const scene = createHologramScene(SCENE_SEED);
  const picture = createGpuPicture(gl, pictureSceneOf(scene));
  const clock = createFrameClock();
  let last = performance.now();
  const frame = (now: number) => {
    clock.advance(Math.min(0.1, (now - last) / 1000), AT_REST);
    last = now;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const state = analyseFrame(clock.frame(), 1);
    drawGpuPicture(gl, picture, { state, pixels: canvas.width, satellites: orbits() });
    // The picture is drawn unfaded; the phone fades the canvas he is on as he arrives, and so does this.
    canvas.style.opacity = String(state.arrival);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Wires the panel's buttons to the stage's satellites and the phone view beside them. */
export function startSatellitesPanel(stage: RoomSatellites): SatellitesPanel {
  const gallery = required('#satellite-agents', HTMLElement);
  const status = required('#satellite-status', HTMLElement);
  const customInput = required('#satellite-path', HTMLInputElement);
  const phoneCanvas = required('#satellites-phone', HTMLCanvasElement);

  let phoneWork: AgentWorkState = NO_WORK;
  const startedAt = performance.now();
  const now = () => (performance.now() - startedAt) / 1000;
  let delegations = 0;

  /** Sends one message, as routing would, to both drawings. Returns whether it was usable. */
  const send = (agent: PanelAgent, state: AgentActivityState): boolean => {
    if (state === 'planned' || agent.delegationId === undefined) {
      delegations += 1;
      agent.delegationId = `preview-${delegations}-${agent.agentId}`;
    }
    const activity: AgentActivity | undefined = agentActivityOf({
      delegationId: agent.delegationId,
      agentId: agent.agentId,
      state,
      glyph: agent.glyph,
    });
    if (activity === undefined) return false;
    stage.activity(activity);
    phoneWork = recordActivity(phoneWork, activity, now());
    // Done, or not let out at all: at most MAX_SATELLITES are out at once, as on every device.
    if (state === 'answered' || state === 'failed' || !phoneWork.satellites.has(activity.delegationId)) {
      agent.delegationId = undefined;
    }
    return activity.glyph !== undefined;
  };

  const agents: PanelAgent[] = AGENT_GLYPHS.map(({ agentId, path }) => ({
    agentId,
    glyph: path,
    delegationId: undefined,
  }));
  const buttons = new Map<PanelAgent, HTMLButtonElement>();
  const live = () => agents.filter((agent) => agent.delegationId !== undefined);
  const refresh = () => {
    for (const [agent, button] of buttons)
      button.setAttribute('aria-pressed', String(agent.delegationId !== undefined));
  };

  const addButton = (agent: PanelAgent) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'glyph';
    button.title = agent.agentId;
    button.dataset.agent = agent.agentId;
    button.append(glyphIcon(agent.glyph), document.createTextNode(agent.agentId));
    button.addEventListener('click', () => {
      if (agent.delegationId === undefined) {
        send(agent, 'planned');
        window.setTimeout(() => send(agent, 'working'), 600);
      } else {
        send(agent, 'answered');
      }
      refresh();
    });
    buttons.set(agent, button);
    gallery.append(button);
  };
  for (const agent of agents) addButton(agent);

  /** What each of the panel's buttons for all of them does: sends each agent it picks one message. */
  const actions: Record<string, { pick: () => PanelAgent[]; state: AgentActivityState }> = {
    all: { pick: () => agents.filter((agent) => agent.delegationId === undefined), state: 'working' },
    tool: { pick: live, state: 'tool' },
    ask: { pick: () => live().slice(0, 1), state: 'asking' },
    fail: { pick: () => live().slice(0, 1), state: 'failed' },
    finish: { pick: live, state: 'answered' },
  };
  const act = (name: string) => {
    const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (action === undefined) return;
    for (const agent of action.pick()) send(agent, action.state);
    refresh();
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-satellites]')) {
    button.addEventListener('click', () => act(button.dataset.satellites ?? ''));
  }

  required('#satellite-try', HTMLButtonElement).addEventListener('click', () => {
    const agent: PanelAgent = { agentId: 'yourGlyph', glyph: customInput.value, delegationId: undefined };
    const drawable = send(agent, 'working');
    status.textContent = drawable
      ? 'Your path is circling him: “Finish all” sends it home.'
      : 'That is not a path the devices draw — only M, L, H, V, A, C, Q, Z and numbers — so it shows as a plain ring.';
    if (drawable) agents.push(agent);
  });

  startPhoneView(phoneCanvas, () => {
    phoneWork = stepWork(phoneWork, now());
    return satelliteOrbits(phoneWork, now());
  });

  return { report: () => stage.report() };
}
