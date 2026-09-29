import type { AppEffect, AppView } from './app-state';

/**
 * What the room shows the browser tests about its state machine, through `window.__jarvisRoom`.
 *
 * `window.__jarvis` (`src/debug-hook.ts`) says whether the room opened, where he was put and
 * whether he is being drawn; this says what the room thinks is going on — the scene, what each
 * panel says, whether the wake word is armed, and the effects of the last few steps — which is
 * what a test driving selects and buttons through the emulated controllers needs to see. Kept
 * apart from `window.__jarvis` only so each can change without the other; a plain object the room
 * writes after every step, which costs nothing when nothing reads it.
 */
export interface JarvisRoomDebugState {
  /** The scene, as `sceneName` spells it: `waiting`, `present:live`, `sample:thinking`, `leaving:wait`… */
  scene: string;
  view: AppView;
  /**
   * The effects carried out recently, oldest first, each as its type and — for the ones about a
   * panel or a mood — what it was about: `hang-up`, `show-panel toast: Listening`, `cycle-sample idle`.
   * A panel that is only up for a moment may be gone by the time a test looks at the view; its
   * effect is still here.
   */
  recentEffects: string[];
}

declare global {
  interface Window {
    __jarvisRoom?: JarvisRoomDebugState;
  }
}

/** How many effects `recentEffects` remembers. */
const REMEMBERED_EFFECTS = 40;

/** An effect in a few words. */
export function describeEffect(effect: AppEffect): string {
  switch (effect.type) {
    case 'show-panel':
      return `show-panel ${effect.panel}: ${effect.lines.join(' / ')}`;
    case 'hide-panel':
      return `hide-panel ${effect.panel}`;
    case 'start-sample':
    case 'cycle-sample':
      return `${effect.type} ${effect.mode}`;
    case 'hologram':
      return `hologram ${effect.state}`;
    case 'set-frame-rate':
      return `set-frame-rate ${effect.target}`;
    default:
      return effect.type;
  }
}

/** Publishes the room's state, keeping the last few effects. */
export function publishRoomDebugState(scene: string, view: AppView, effects: readonly AppEffect[]): void {
  const previous = window.__jarvisRoom?.recentEffects ?? [];
  const recentEffects = [...previous, ...effects.map(describeEffect)].slice(-REMEMBERED_EFFECTS);
  window.__jarvisRoom = { scene, view, recentEffects };
}
