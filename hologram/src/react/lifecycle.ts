/**
 * The parts of `hologram/react` a screen needs without the view.
 *
 * **Nothing in this file, or anything it imports, may load expo-gl.** On a device it asks for its
 * native module as it loads and throws in a build without one, and the view loads it only once it
 * has found the module (`gl-context.ts`). So the screen-level pieces live here, apart from the view,
 * and `react.contract.spec.ts` checks that nothing on this side of the line reaches across it.
 */

export { AgentSatellitesContext, useAgentSatellites } from './agent-satellites';
export { useIsForeground } from './is-foreground';
export { useJarvisServer } from './jarvis-server';
export { LEAVING_SECONDS } from './leaving';
