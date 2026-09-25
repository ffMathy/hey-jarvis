import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import { AppRegistry } from 'react-native';
import { App } from './src/app';
import { ASSISTANT_SURFACE, SHOWING_PROP } from './src/assistant-window';

/** The app as anyone opens it: from the launcher, from a deep link, or by the plain assist intent. */
function LaunchedApp() {
  return createElement(App);
}

/**
 * The app as the assistant's own window draws it.
 *
 * The same component, told that it is being asked rather than opened — there is no launch URL to
 * read here, because nothing was launched — and which showing of the window this is, which the
 * session changes every time it is shown. See `assistant-window.ts`.
 */
function SummonedApp(props: { [SHOWING_PROP]?: number }) {
  return createElement(App, { summoned: true, showing: props[SHOWING_PROP] });
}

// `registerRootComponent` is `AppRegistry.registerComponent` plus the wiring the
// Expo runtime expects, so the app boots the same way whether it was launched
// from the launcher, from a deep link, or by the system as the assistant.
registerRootComponent(LaunchedApp);

// The second surface needs no such wiring: the first registration did it for the process, and this
// only has to answer to a name the native side can start.
AppRegistry.registerComponent(ASSISTANT_SURFACE, () => SummonedApp);
