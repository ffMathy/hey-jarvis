import type { Object3D } from 'three';
import { createKeyboardGlyph, KEYBOARD_GLYPH_METRES, type KeyboardGlyph } from '../ui3d/keyboard-glyph';
import { createTagAlong, placeUnder, type TagAlong } from '../ui3d/panel-placement';
import { createPointerArrow, type PointerArrow } from '../ui3d/pointer-arrow';
import { createTextPanel, type TextPanel } from '../ui3d/text-panel';
import type { Vector3Like } from '../xr/ray';
import { type CentreEye, pointAhead } from '../xr/viewer-pose';
import type { PanelName } from './app-state';

/**
 * Every panel the room can show, made once per session and moved into place each frame.
 *
 * Which of them are showing, and what they say, is `app-state.ts`'s to decide; this only carries
 * out its show and hide effects and keeps each panel where it belongs — the ones about Jarvis
 * under him, the ones about the room tagging along after the gaze (see `panel-placement.ts`).
 */

/** How far ahead the hint and the status line drift, and how far below eye level. */
const TAG_ALONG_AHEAD_METRES = 1.3;
const HINT_DROP_METRES = 0.18;
const STATUS_DROP_METRES = 0.32;

/** How far his content reaches, in radii: what is under him has to clear it. */
const REACH_IN_RADII = 1.9;

/** The gap between him, or one panel, and the next thing under it, in metres. */
const GAP_METRES = 0.03;

export interface RoomPanels {
  /** Everything to add to the scene. */
  readonly objects: Object3D[];
  readonly keyboard: KeyboardGlyph;
  show(panel: PanelName, lines: readonly string[]): void;
  hide(panel: PanelName): void;
  /** The frame-rate readout's text, measured by the room rather than decided by the state. */
  setReadout(text: string): void;
  /**
   * Moves everything into place for this frame: `spot` is where he stands and `radius` his size,
   * or undefined while he is not in the room.
   */
  arrange(eye: CentreEye, spot: Vector3Like | undefined, radius: number, deltaSeconds: number, pointTo: boolean): void;
  dispose(): void;
}

export function createRoomPanels(): RoomPanels {
  const text: Record<Exclude<PanelName, 'keyboard'>, TextPanel> = {
    hint: createTextPanel({ widthMetres: 0.7, tone: 'hint' }),
    status: createTextPanel({ widthMetres: 0.8, tone: 'status' }),
    error: createTextPanel({ widthMetres: 0.6, tone: 'error' }),
    toast: createTextPanel({ widthMetres: 0.5, tone: 'toast' }),
    caption: createTextPanel({ widthMetres: 0.7, tone: 'caption' }),
    readout: createTextPanel({ widthMetres: 0.5, tone: 'hud' }),
  };
  const keyboard = createKeyboardGlyph();
  const arrow: PointerArrow = createPointerArrow();
  const hintTag: TagAlong = createTagAlong();
  const statusTag: TagAlong = createTagAlong();
  let readout = '';
  let readoutShown = false;

  /** Stacks the panels that hang under him, top to bottom, each just clear of the one above. */
  function hangUnder(spot: Vector3Like, radius: number, eye: Vector3Like) {
    let offset = -(REACH_IN_RADII * radius + GAP_METRES);
    const stack: { object: Object3D; visible: boolean; height: number }[] = [
      { object: keyboard.object, visible: keyboard.visible, height: KEYBOARD_GLYPH_METRES },
      { object: text.toast.object, visible: text.toast.visible, height: text.toast.heightMetres },
      { object: text.caption.object, visible: text.caption.visible, height: text.caption.heightMetres },
      { object: text.readout.object, visible: text.readout.visible, height: text.readout.heightMetres },
    ];
    for (const item of stack) {
      if (!item.visible) continue;
      placeUnder(item.object, spot, offset - item.height / 2, eye);
      offset -= item.height + GAP_METRES;
    }
  }

  return {
    objects: [...Object.values(text).map((panel) => panel.object), keyboard.object, arrow.object],
    keyboard,
    show(panel, lines) {
      if (panel === 'keyboard') {
        keyboard.visible = true;
        return;
      }
      if (panel === 'readout') {
        readoutShown = true;
        text.readout.setText(readout ? [readout] : ['…']);
        return;
      }
      if (panel === 'hint' && !text.hint.visible) hintTag.reset();
      if (panel === 'status' && !text.status.visible) statusTag.reset();
      text[panel].setText(lines);
    },
    hide(panel) {
      if (panel === 'keyboard') keyboard.visible = false;
      else text[panel].setText(undefined);
      if (panel === 'readout') readoutShown = false;
    },
    setReadout(value) {
      readout = value;
      if (readoutShown) text.readout.setText([value]);
    },
    arrange(eye, spot, radius, deltaSeconds, pointTo) {
      const ahead = pointAhead(eye, TAG_ALONG_AHEAD_METRES);
      if (text.hint.visible) {
        const target = { x: ahead.x, y: ahead.y - HINT_DROP_METRES, z: ahead.z };
        hintTag.follow(text.hint.object, target, eye.position, deltaSeconds);
      }
      if (text.status.visible) {
        const target = { x: ahead.x, y: ahead.y - STATUS_DROP_METRES, z: ahead.z };
        statusTag.follow(text.status.object, target, eye.position, deltaSeconds);
      }
      if (spot !== undefined) {
        // The error hangs where he stands, pulled towards the viewer so it is in front of him, not in him.
        const towards = { x: eye.position.x - spot.x, y: 0, z: eye.position.z - spot.z };
        const length = Math.hypot(towards.x, towards.z) || 1;
        const front = {
          x: spot.x + (towards.x / length) * radius * 1.2,
          y: spot.y,
          z: spot.z + (towards.z / length) * radius * 1.2,
        };
        placeUnder(text.error.object, front, 0, eye.position);
        hangUnder(spot, radius, eye.position);
      }
      arrow.update(eye, pointTo ? spot : undefined);
    },
    dispose() {
      for (const panel of Object.values(text)) panel.dispose();
      keyboard.dispose();
      arrow.dispose();
    },
  };
}
