/**
 * The conversation with Jarvis, for the React Native apps that hold one: the phone and the watch.
 *
 * The package's third entry, and the split is the same argument as the other two. `hologram` is the
 * design, the voice tracking, the credentials and the conversation's framework-free parts —
 * `createJarvisSession` among them, the session every device runs — with no framework in it, so it
 * runs headless in the tests and on the headset with no React at all. `hologram/react` needs React,
 * Reanimated and Skia for real. This one needs React, the ElevenLabs SDK's client and, on a device,
 * LiveKit's audio session and this package's own greeting player — and deliberately not Skia, so
 * that a screen can hold a conversation before CanvasKit has finished loading in a browser, which is
 * precisely the case `mobile/src/jarvis-hologram.web.tsx` exists to handle.
 *
 * What is here is only the wiring a screen needs: `useJarvisSession` hands the session the SDK, the
 * greeting's player, the call's audio and a timer, and holds its snapshot in React. The rules are the
 * main entry's.
 *
 * `@elevenlabs/react-native` is a side-effect module — importing it installs the WebRTC globals and
 * registers the voice session strategy on `@elevenlabs/client`, which this entry dials with — so the
 * app that renders these has to import it first itself, at the top of its own entry. See the note at
 * the top of `mobile/src/app.tsx`; getting it wrong fails at runtime with "No voice session setup
 * strategy registered", nowhere near the cause.
 */
export { type JarvisConversation, type JarvisSessionOptions, useJarvisSession } from './session';
