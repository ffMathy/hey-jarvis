import type { JarvisDebugState } from '../debug-hook';
import type { AppEffect, AppView } from './app-state';

/**
 * The room's part of `window.__jarvis` (`src/debug-hook.ts`): what the state machine thinks is
 * going on, rewritten after every step that changed anything — which costs nothing when nothing
 * reads it.
 */

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

/** Publishes the room's state into `debug`, keeping the last few effects. */
export function publishRoomDebugState(
  debug: JarvisDebugState,
  scene: string,
  view: AppView,
  effects: readonly AppEffect[],
): void {
  const previous = debug.room?.recentEffects ?? [];
  const recentEffects = [...previous, ...effects.map(describeEffect)].slice(-REMEMBERED_EFFECTS);
  debug.room = { scene, view, recentEffects };
}
