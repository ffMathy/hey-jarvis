---
paths:
  - "mobile/**"
---

# What happens to a sentence he is cut off in

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

Nothing, unless somebody does it — and in a browser that showed. Jarvis is interrupted, the server
stops sending, and whatever his `<audio>` element had already taken in stays in it, so the tail of
the sentence he was cut off in came out at the head of his next one: the same take, clipped.

There is no queue to clear in this app or in the SDK. Over WebRTC the SDK's `interrupt()` is a
documented no-op, because audio is a live LiveKit track rather than chunks the client buffers, and
audio arriving on the data channel is deliberately not re-played. (The `audioConcatProcessor` queue
that *does* have this shape is the WebSocket transport's, which here carries no audio at all.) The
only queue left is the media element's own, so the session empties it on every interruption, through
`flushQueuedAudio` in `hologram/src/queued-audio.ts`: clearing `srcObject`
tears the element's renderer down and takes the queued audio with it, and putting the same live
stream back builds a new one at the live edge. It hangs off the SDK's `onInterruption` — which the
agent sends because `interruption` is in its `clientEvents` — and an interruption is exactly the
moment there is nothing left worth playing.

On a phone this costs one empty loop. `attachedElements` is LiveKit's, and it only ever fills in a
browser: Android plays the agent's track natively, with no element and no queue of its own.
