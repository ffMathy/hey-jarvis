/**
 * The conversation with Jarvis: what it takes to open one, and what to say when it cannot be.
 *
 * A package of its own rather than a folder in the phone app, for the reason `hologram/` is one —
 * there are now two devices that hold a conversation with the same ElevenLabs agent, the phone and
 * the watch, and neither of them should own the other's copy of the credentials or of the twelve
 * ways ElevenLabs can say no.
 *
 * Nothing in this entry reaches a device or an SDK: it is the credentials, their validation, and
 * one `fetch` to mint a token. That is what lets `conversation-token.spec.ts` exercise every
 * failure path with no account and no emulator. The half that calls into
 * `@elevenlabs/react-native` is `conversation/react`.
 */
export * from './conversation-token';
export * from './elevenlabs-settings';
