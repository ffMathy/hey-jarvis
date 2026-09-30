import { Group, type Object3D } from 'three';
import type { Vector3Like } from '../xr/ray';
import { placeUnder } from './panel-placement';
import { createTextPanel, type TextPanel } from './text-panel';

/**
 * Names over the things sir has placed: over the token he carries, over each one standing in the
 * room while he places things, and over the one he points at.
 *
 * A small pool of text panels, each kept for the same key from frame to frame, so a name is drawn
 * into its canvas once and only moved after that; a panel whose key is gone is hidden, and given to
 * the next new key. Each hangs just above the point it names, upright and turned to the eyes.
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

export function createEntityLabels(): EntityLabels {
  const group = new Group();
  const panels: TextPanel[] = [];
  const keys: (string | undefined)[] = [];

  function panelFor(key: string, taken: ReadonlySet<number>): TextPanel | undefined {
    const kept = keys.indexOf(key);
    if (kept >= 0 && !taken.has(kept)) return panels[kept];
    const free = keys.findIndex((existing, index) => existing === undefined && !taken.has(index));
    const index = free >= 0 ? free : panels.length < MAX_LABELS ? panels.length : -1;
    if (index < 0) return undefined;
    if (index === panels.length) {
      const panel = createTextPanel({ widthMetres: LABEL_WIDTH_METRES, tone: 'label' });
      panels.push(panel);
      group.add(panel.object);
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
        taken.add(panels.indexOf(panel));
        panel.setText([label.text]);
        placeUnder(panel.object, label.position, label.above + panel.heightMetres / 2, eye);
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
