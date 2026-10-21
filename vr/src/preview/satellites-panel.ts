import {
  type AgentActivity,
  type AgentActivityState,
  type AgentWorkState,
  agentActivityOf,
  createSatelliteResources,
  drawSatellites,
  NO_WORK,
  recordActivity,
  type SatelliteOrbit,
  SPHERE_FRACTION,
  satelliteOrbits,
  stepWork,
} from 'hologram';
import { AGENT_GLYPHS } from '../../../mcp/mastra/verticals/agent-glyphs';
import type { RoomSatellites } from '../app/room-satellites';
import type { Painter } from '../hologram3d';
import { wrapCanvas } from '../hologram3d/canvaskit';

/**
 * The preview's satellites panel: every agent's glyph, as its vertical on the server declares it
 * (`mcp/mastra/verticals/agent-glyphs.ts` — files that import nothing, read here at build time, so
 * the page needs no server), to set to work round him and watch both ways they are drawn: in 3D on
 * the stage, as the headset draws them, and flat beside it, as the phone and its web build do
 * (`hologram`'s `satellite-drawing.ts`, in CanvasKit). A path of your own can be tried in the same
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

/**
 * The flat view: the satellites as the phone draws them, round a ring where he would be, in
 * CanvasKit on its own canvas, every frame.
 */
function startPhoneView(canvas: HTMLCanvasElement, painter: Painter, orbits: () => SatelliteOrbit[]) {
  const surface = painter.canvasKit.MakeSWCanvasSurface(canvas);
  if (surface === null) return;
  const resources = createSatelliteResources(painter.skia);
  // Where he would be, so the ring has something to go round.
  const outline = new painter.canvasKit.Paint();
  outline.setAntiAlias(true);
  outline.setStyle(painter.canvasKit.PaintStyle.Stroke);
  outline.setColor(painter.canvasKit.Color(90, 60, 40, 1));
  const started = performance.now();
  const frame = () => {
    const seconds = (performance.now() - started) / 1000;
    const raw = surface.getCanvas();
    raw.clear(painter.canvasKit.BLACK);
    raw.drawCircle(canvas.width / 2, canvas.height / 2, canvas.width * SPHERE_FRACTION, outline);
    const made = drawSatellites(wrapCanvas(painter, raw), painter.skia, canvas.width, seconds, orbits(), resources);
    surface.flush();
    for (const path of made) path?.dispose();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Wires the panel's buttons to the stage's satellites and the phone view beside them. */
export function startSatellitesPanel(stage: RoomSatellites, painter: Painter): SatellitesPanel {
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

  startPhoneView(phoneCanvas, painter, () => {
    phoneWork = stepWork(phoneWork, now());
    return satelliteOrbits(phoneWork, now());
  });

  return { report: () => stage.report() };
}
