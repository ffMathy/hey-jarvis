import { Group, Matrix4, Mesh, type Object3D, PlaneGeometry, Vector3 } from 'three';
import type { DrawerEntry, PlacementState } from '../entities/registry';
import type { Vector3Like } from '../xr/ray';
import {
  buttonPoint,
  clampPage,
  DRAWER_BUTTON_RADIUS_METRES,
  DRAWER_HEADER_METRES,
  DRAWER_HEIGHT_METRES,
  DRAWER_MARGIN_METRES,
  DRAWER_WIDTH_METRES,
  type DrawerButton,
  type DrawerPoint,
  type DrawerPose,
  drawerToRoom,
  entriesOnPage,
  pageCount,
  SLOT_HEIGHT_METRES,
  SLOT_WIDTH_METRES,
  slotCentre,
  tokenPoint,
} from './drawer-layout';
import { truncateLines, wrapParagraph } from './text-layout';
import {
  CANVAS_MARGIN_PIXELS,
  canvasMetres,
  canvasPixels,
  createCanvasMaterial,
  createCanvasTexture,
  drawingContext,
  PIXELS_PER_METRE,
  roundedRectangle,
  withMargin,
} from './ui-canvas';
import { UI_COLOURS } from './ui-colours';

/**
 * The drawer: every entity Jarvis has worked on, by name, a page at a time, for sir to take and put
 * where it is in the room.
 *
 * One canvas for the whole board — the names, the page, a line for what just happened, the page
 * buttons and Done — on one plane, world-locked where it opened (`drawer-layout.ts` says where
 * everything on it goes). The tokens that float over its slots are drawn by `entity-tokens.ts`, so
 * one taken away can leave its slot empty without the board being redrawn. It is redrawn only when
 * what it shows changes: the canvas upload is the one cost it has.
 *
 * What still needs a place comes first — never placed, or placed on an anchor this headset no longer
 * has, which says so in the danger colour — then what is already in the room, marked as such.
 */

/** One slot on the page being shown: the entity, and where its token floats in the room. */
export interface DrawerSlot {
  id: string;
  label: string;
  state: PlacementState;
  position: Vector3Like;
}

export interface EntityDrawer {
  readonly object: Object3D;
  /** Where it stands, or undefined while it is closed. */
  readonly pose: DrawerPose | undefined;
  readonly page: number;
  /** Opens it at `pose`, on its first page. */
  open(pose: DrawerPose): void;
  close(): void;
  /** What it shows: every entry, in the order to show them, and a line about what just happened. */
  show(entries: readonly DrawerEntry[], message: string | undefined): void;
  /** The entries on the page being shown, with where each one's token floats. */
  slots(): DrawerSlot[];
  /** The buttons it has now: Done always, the page buttons only with pages to turn. */
  buttons(): ReadonlySet<DrawerButton>;
  /** Carries out a button: turns the page, or says it was Done. */
  press(button: DrawerButton): 'done' | undefined;
  dispose(): void;
}

/** Letter heights, in metres: the title, a name, and the small print. */
const TITLE_METRES = 0.016;
const NAME_METRES = 0.0125;
const SMALL_METRES = 0.0095;

/** How big the socket drawn under each token is: the size of the token's ring, which sits in it. */
const SOCKET_METRES = 0.019;

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** What the drawer says with nothing in it. */
export const EMPTY_DRAWER_LINES = [
  'Nothing to place yet.',
  'Whatever Jarvis works on for you — a light, an inbox, a calendar — appears here.',
];

/** What a slot says under a name, by the entity's state; nothing for one waiting to be placed. */
const STATE_NOTES: Record<PlacementState, string | undefined> = {
  unplaced: undefined,
  placed: 'in the room',
  lost: 'lost — place it again',
};

/**
 * A point on the board, as a pixel of the board's picture: its left edge is x 0, its top edge y 0.
 * The canvas is a margin larger all round (`ui-canvas.ts`), and drawn with its origin moved by it.
 */
function toCanvas(point: DrawerPoint): { x: number; y: number } {
  return {
    x: (point.x + DRAWER_WIDTH_METRES / 2) * PIXELS_PER_METRE,
    y: (DRAWER_HEIGHT_METRES / 2 - point.y) * PIXELS_PER_METRE,
  };
}

interface DrawnState {
  entries: readonly DrawerEntry[];
  page: number;
  pages: number;
  message: string | undefined;
}

function drawBoard(context: CanvasRenderingContext2D, width: number, height: number, state: DrawnState) {
  const margin = canvasPixels(DRAWER_MARGIN_METRES);
  roundedRectangle(context, 1, 1, width - 2, height - 2, margin);
  context.fillStyle = 'rgba(5, 7, 13, 0.8)';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = UI_COLOURS.accent;
  context.stroke();

  // The header: what this is, which page, and what just happened.
  context.textBaseline = 'middle';
  context.fillStyle = UI_COLOURS.text;
  context.font = `600 ${canvasPixels(TITLE_METRES)}px ${SANS}`;
  context.textAlign = 'left';
  const titleY = margin + canvasPixels(DRAWER_HEADER_METRES * 0.32);
  context.fillText('What Jarvis works on', margin * 1.5, titleY);
  if (state.pages > 1) {
    context.textAlign = 'right';
    context.fillStyle = UI_COLOURS.mutedText;
    context.fillText(`${state.page + 1} / ${state.pages}`, width - margin * 1.5, titleY);
  }
  const messageY = margin + canvasPixels(DRAWER_HEADER_METRES * 0.75);
  context.font = `400 ${canvasPixels(SMALL_METRES)}px ${SANS}`;
  context.textAlign = 'left';
  context.fillStyle = state.message === undefined ? UI_COLOURS.mutedText : UI_COLOURS.accent;
  const hint = state.entries.length === 0 ? '' : 'Take one, and let go where it is in the room.';
  context.fillText(state.message ?? hint, margin * 1.5, messageY, width - margin * 3);

  const shown = entriesOnPage(state.entries, state.page);
  if (shown.length === 0) drawEmpty(context, width);
  for (const [index, entry] of shown.entries()) drawSlot(context, entry, index);
  drawFooter(context, state);
}

function drawEmpty(context: CanvasRenderingContext2D, width: number) {
  const middle = toCanvas({ x: 0, y: slotCentre(4).y, z: 0 });
  context.textAlign = 'center';
  context.fillStyle = UI_COLOURS.text;
  context.font = `500 ${canvasPixels(NAME_METRES * 1.2)}px ${SANS}`;
  const [first, ...rest] = EMPTY_DRAWER_LINES;
  context.fillText(first ?? '', middle.x, middle.y - canvasPixels(0.02));
  context.font = `400 ${canvasPixels(SMALL_METRES)}px ${SANS}`;
  context.fillStyle = UI_COLOURS.mutedText;
  const lines = rest.flatMap((line) => wrapParagraph(line, width * 0.8, (text) => context.measureText(text).width));
  for (const [row, line] of lines.entries())
    context.fillText(line, middle.x, middle.y + canvasPixels(0.005 + row * 0.014));
}

function drawSlot(context: CanvasRenderingContext2D, entry: DrawerEntry, index: number) {
  const token = toCanvas(tokenPoint(index));
  const slot = slotCentre(index);
  // The socket its token floats over, so an empty slot still reads as one — its token is in a hand.
  context.beginPath();
  context.arc(token.x, token.y, canvasPixels(SOCKET_METRES), 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = entry.state === 'lost' ? UI_COLOURS.danger : UI_COLOURS.border;
  context.stroke();

  const nameTop = token.y + canvasPixels(SOCKET_METRES) + canvasPixels(0.002);
  const nameHeight = canvasPixels(NAME_METRES * 1.2);
  const maxWidth = canvasPixels(SLOT_WIDTH_METRES) - 8;
  context.font = `500 ${canvasPixels(NAME_METRES)}px ${SANS}`;
  const measure = (text: string) => context.measureText(text).width;
  const lines = truncateLines(wrapParagraph(entry.label, maxWidth, measure), 2, maxWidth, measure);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = entry.state === 'placed' ? UI_COLOURS.mutedText : UI_COLOURS.text;
  const centreX = toCanvas(slot).x;
  for (const [row, line] of lines.entries()) context.fillText(line, centreX, nameTop + nameHeight * (row + 0.5));

  const note = STATE_NOTES[entry.state];
  if (note === undefined) return;
  context.font = `400 ${canvasPixels(SMALL_METRES)}px ${SANS}`;
  context.fillStyle = entry.state === 'lost' ? UI_COLOURS.danger : UI_COLOURS.mutedText;
  const bottom = toCanvas({ x: 0, y: slot.y - SLOT_HEIGHT_METRES / 2, z: 0 }).y;
  context.fillText(note, centreX, bottom - canvasPixels(SMALL_METRES * 0.65), maxWidth);
}

function drawDisc(context: CanvasRenderingContext2D, button: DrawerButton, label: string, filled: boolean) {
  const middle = toCanvas(buttonPoint(button));
  const radius = canvasPixels(DRAWER_BUTTON_RADIUS_METRES);
  context.beginPath();
  if (button === 'done')
    roundedRectangle(context, middle.x - radius * 2.2, middle.y - radius, radius * 4.4, radius * 2, radius);
  else context.arc(middle.x, middle.y, radius, 0, Math.PI * 2);
  context.fillStyle = filled ? UI_COLOURS.accent : UI_COLOURS.surface;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = UI_COLOURS.accent;
  context.stroke();
  context.fillStyle = filled ? UI_COLOURS.background : UI_COLOURS.text;
  context.font = `700 ${canvasPixels(NAME_METRES * 1.25)}px ${SANS}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, middle.x, middle.y);
}

function drawFooter(context: CanvasRenderingContext2D, state: DrawnState) {
  drawDisc(context, 'done', 'Done', true);
  if (state.pages <= 1) return;
  drawDisc(context, 'previous', '‹', false);
  drawDisc(context, 'next', '›', false);
}

export interface EntityDrawerOptions {
  /** The renderer's most anisotropic filtering: the board is tilted back, and read along its tilt. */
  anisotropy: number;
}

export function createEntityDrawer(options: EntityDrawerOptions): EntityDrawer {
  const boardWidth = canvasPixels(DRAWER_WIDTH_METRES);
  const boardHeight = canvasPixels(DRAWER_HEIGHT_METRES);
  const canvas = document.createElement('canvas');
  canvas.width = withMargin(boardWidth);
  canvas.height = withMargin(boardHeight);
  const context = drawingContext(canvas);
  const texture = createCanvasTexture(canvas, options.anisotropy);
  const material = createCanvasMaterial(texture);
  // The board's own size and a margin all round, so its middle is the board's middle.
  const board = new Mesh(new PlaneGeometry(canvasMetres(canvas.width), canvasMetres(canvas.height)), material);
  // Under the tokens floating over it (9) and the labels and panels (10).
  board.renderOrder = 8;
  const group = new Group();
  group.add(board);
  group.visible = false;

  let pose: DrawerPose | undefined;
  let entries: readonly DrawerEntry[] = [];
  let message: string | undefined;
  let page = 0;
  let drawnKey = '';

  function redraw() {
    page = clampPage(page, entries.length);
    const state = { entries, page, pages: pageCount(entries.length), message };
    const shown = entriesOnPage(entries, page);
    const key = JSON.stringify([page, state.pages, message, entries.length === 0, shown]);
    if (key === drawnKey) return;
    drawnKey = key;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(CANVAS_MARGIN_PIXELS, CANVAS_MARGIN_PIXELS);
    drawBoard(context, boardWidth, boardHeight, state);
    texture.needsUpdate = true;
  }

  return {
    object: group,
    get pose() {
      return pose;
    },
    get page() {
      return page;
    },
    open(opened) {
      pose = opened;
      page = 0;
      const { centre, right, up, normal } = opened;
      const axes = new Matrix4().makeBasis(
        new Vector3(right.x, right.y, right.z),
        new Vector3(up.x, up.y, up.z),
        new Vector3(normal.x, normal.y, normal.z),
      );
      group.quaternion.setFromRotationMatrix(axes);
      group.position.set(centre.x, centre.y, centre.z);
      group.visible = true;
      redraw();
    },
    close() {
      pose = undefined;
      group.visible = false;
    },
    show(shown, said) {
      entries = shown;
      message = said;
      redraw();
    },
    slots() {
      const opened = pose;
      if (opened === undefined) return [];
      return entriesOnPage(entries, page).map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        state: entry.state,
        position: drawerToRoom(opened, tokenPoint(index)),
      }));
    },
    buttons() {
      return new Set<DrawerButton>(pageCount(entries.length) > 1 ? ['previous', 'done', 'next'] : ['done']);
    },
    press(button) {
      if (button === 'done') return 'done';
      const pages = pageCount(entries.length);
      page = (page + (button === 'next' ? 1 : pages - 1)) % pages;
      redraw();
      return undefined;
    },
    dispose() {
      texture.dispose();
      material.dispose();
      board.geometry.dispose();
    },
  };
}
