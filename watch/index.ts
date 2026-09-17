import { registerRootComponent } from 'expo';
import { App } from './src/app';

// The same entry the phone app uses: `AppRegistry.registerComponent` plus the
// wiring the Expo runtime expects, so the app boots the same way whether the
// watch launched it from the app list or the system did as the assistant.
registerRootComponent(App);
