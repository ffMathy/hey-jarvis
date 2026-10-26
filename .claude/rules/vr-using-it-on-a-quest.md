---
paths:
  - "vr/**"
---

# Using it on a Quest

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

Open **https://ffmathy.github.io/hey-jarvis/vr/** in Quest Browser. Quest 3
and 3S are the target; Quest 2 and Pro work, without the room scan.

1. **The ElevenLabs agent.** The page asks for an API key and an agent ID once,
   and checks them by minting a token before keeping them. They are the phone's
   settings, stored the phone's way on the same origin, so a browser that has
   the phone's web build set up already has them.
2. **Getting ready.** The wake-word models load with a progress bar while you
   read the page.
3. **Allow the microphone** — the first tap. Skipped when the browser says the
   permission is already granted.
4. **Enter your room** — the second tap.
5. **"Hey Jarvis"**, or a pinch or a trigger pull (an XR `select`). He is placed,
   arrives, says the firmware's recorded "Hello sir, how can I help?" while the
   session is fetched, and then the conversation is live.

While you wait, nothing is drawn but a hint — "Say “Hey Jarvis”", shown only
once the wake engine has really scored live audio — and, whenever it is not
listening, a status line saying why and what to do about it.

- **Sending him away:** a select held for 0.8 s or longer, or B/Y, hangs up; the
  agent can also end the call itself. A short select during a call does nothing:
  hands pinch by accident while people talk. A wake word or a select while he is
  leaving cancels the fade and summons him again.
- **Typing:** while the call is live, a keyboard button under him opens the
  headset's system keyboard; a line is sent on a newline or when the keyboard is
  put away, and his reply is written under him.
- **When something fails** — a rejected key, no network, a call that drops — the
  problem hangs at his spot for as long as it takes to read, then he leaves and
  the wake word is armed again. The 2D page shows the last problem once the room
  is closed.
- **Try him in your room** is sample mode: no key and no microphone. It opens on
  a drawer of made-up entities — a kitchen light, a TV, an inbox — since the real
  drawer only offers what Jarvis has worked on in a conversation and so starts
  empty. They are kept apart from the real ones, under
  `jarvis.horizon.sample-entities` (`entities/sample-entities.ts`), and only
  sample mode shows them; it never has a conversation, so nothing about them
  reaches the Jarvis server. Place some, press Done (or B/Y), and he arrives.
  Select him to walk his moods (speaking, listening, thinking, idle); select
  anywhere else to leave. Point at a placed sample (on a phone, tap it) and it is
  ringed and its corona lights, as if he had been asked to work on it; while he
  thinks, every placed sample lights up.
- **Placing what he works on:** whatever Jarvis works on for you — a light, an
  inbox, a calendar — goes into a drawer, by name. **Place entities** on the 2D
  page (no key, no microphone), or A/X or the button on the back of a raised wrist
  while he is waiting, opens it in front of you: take one with a pinch or a
  controller's grip and let go where it is in the room, or point at something out
  of reach and pinch or pull the trigger, and again where it goes. Let go on the
  drawer and it goes back in. Done, B/Y or the same button again closes it. The
  next time he works on something you placed, his golden corona lights round it;
  point at one — a controller, or an index finger with the others curled — and a
  blue ring and its name say that "turn that on" now means it (see "Entities
  placed in the room" below).
- **Where things are:** outside the drawer, every placed entity has a small dot
  — no ring, never smaller than 0.35° — so you can see what there is to point at.
- **No headset?** https://ffmathy.github.io/hey-jarvis/vr/preview.html shows
  him in 3D on a desktop, phase by phase (see "The preview page" below).
- **His voice from where he stands:** on a headset with an echo canceller of its
  own, his voice comes from his spot in the room, and it moves with your head;
  otherwise it comes from the headset, as before. A switch on the 2D page turns it
  off (see "His voice from where he stands" below).
- **URL flags:** `?debug` shows a diagnostics HUD in the room; `?microphone=raw` listens for
  the wake word without echo cancellation, noise suppression or gain control, to
  try on a headset whether it hears better that way; `?voice=spatial` plays his
  voice from where he stands even when the microphone says the headset has no
  echo canceller of its own, to hear what that does; `?film` is for recordings,
  and leaves sample mode's frame-rate readout out (see "The demo video");
  `?origin=x,z,yawDegrees` moves the room's space from where the headset put it,
  for the browser tests only (`xr/origin-offset.ts`), as are `?deadline=never`,
  which keeps a summoning waiting for a conversation that never opens, and
  `?errors=held`, which keeps an error panel up until a select or B
  (`test-seams.ts`; see "The browser tests").
