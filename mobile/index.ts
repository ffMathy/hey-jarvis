import { registerRootComponent } from 'expo';
import { App } from './src/app';

// `registerRootComponent` is `AppRegistry.registerComponent` plus the wiring the
// Expo runtime expects, so the app boots the same way whether it was launched
// from the launcher, from a deep link, or by the system as the assistant.
registerRootComponent(App);
