import { Group, type Object3D } from 'three';
import { distanceBetween, type Vector3Like } from '../xr/ray';
import { placeUnder } from './panel-placement';
import { createTextPanel, type TextPanel } from './text-panel';

/**
 * Names over the things sir has placed: over the token he carries, over each one standing in the
 * room while he places things, and over the one he points at.
 *
 * A small pool of text panels, each kept for the same key from frame to frame, so a name is drawn
 * into its canvas once and only moved after that; a panel whose key is gone is hidden, and given to
 * the next new key. Each hangs just above the point it names, upright and turned to the eyes, and
 * beyond arm's length grows with its distance, so a lamp pointed at across the room is named as
 * legibly as one on the desk.
 */

/** One name to show: `key` keeps it on the same panel from frame to frame. */
export interface EntityLabel {
  key: string;
  text: string;
  /** What it names: it hangs just above this. */
  position: Vector3Like;
  /** How far above, from the point to the label's lower edge, in metres. */
  above: number;
}

export interface EntityLabels {
  readonly object: Object3D;
  /** The names to show this frame, each turned to face `eye`. */
  set(labels: readonly EntityLabel[], eye: Vector3Like): void;
  dispose(): void;
}

/** The most names shown at once; beyond it, the last are left out. */
export const MAX_LABELS = 24;

/** How wide a name may be before it wraps. */
const LABEL_WIDTH_METRES = 0.26;

/** Out to here a name is its own size; beyond, it grows with the distance, keeping its apparent size. */
export const LABEL_TRUE_SIZE_METRES = 1.2;

/** How much bigger than its own size a name is drawn at `distance` from the eyes. */
export function labelScaleAt(distance: number): number {
  return Math.max(1, distance / LABEL_TRUE_SIZE_METRES);
}

export interface EntityLabelsOptions {
  /** The renderer's most anisotropic filtering (see `ui-canvas.ts`). */
  anisotropy: number;
}

export function createEntityLabels(options: EntityLabelsOptions): EntityLabels {
  const group = new Group();
  const panels: TextPanel[] = [];
  // Each panel hangs in a holder of its own, which is what is moved and scaled: the panel's own
  // scale is its size in metres, set whenever its text is drawn.
  const holders: Group[] = [];
  const keys: (string | undefined)[] = [];

  function panelFor(key: string, taken: ReadonlySet<number>): TextPanel | undefined {
    const kept = keys.indexOf(key);
    if (kept >= 0 && !taken.has(kept)) return panels[kept];
    const free = keys.findIndex((existing, index) => existing === undefined && !taken.has(index));
    const index = free >= 0 ? free : panels.length < MAX_LABELS ? panels.length : -1;
    if (index < 0) return undefined;
    if (index === panels.length) {
      const panel = createTextPanel({ widthMetres: LABEL_WIDTH_METRES, tone: 'label', anisotropy: options.anisotropy });
      const holder = new Group();
      holder.add(panel.object);
      panels.push(panel);
      holders.push(holder);
      group.add(holder);
    }
    keys[index] = key;
    return panels[index];
  }

  return {
    object: group,
    set(labels, eye) {
      const taken = new Set<number>();
      // Panels whose key is not shown this frame are given up first, so a new key can have one.
      const wanted = new Set(labels.map((label) => label.key));
      keys.forEach((key, index) => {
        if (key !== undefined && !wanted.has(key)) keys[index] = undefined;
      });
      for (const label of labels) {
        const panel = panelFor(label.key, taken);
        if (panel === undefined) continue;
        const index = panels.indexOf(panel);
        const holder = holders[index];
        if (holder === undefined) continue;
        taken.add(index);
        panel.setText([label.text]);
        const scale = labelScaleAt(distanceBetween(label.position, eye));
        holder.scale.setScalar(scale);
        placeUnder(holder, label.position, label.above + (panel.heightMetres * scale) / 2, eye);
      }
      panels.forEach((panel, index) => {
        if (!taken.has(index)) {
          panel.setText(undefined);
          keys[index] = undefined;
        }
      });
    },
    dispose() {
      for (const panel of panels) panel.dispose();
    },
  };
}
