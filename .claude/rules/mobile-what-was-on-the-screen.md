---
paths:
  - "mobile/**"
---

# What was on the screen

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Summoned by the assistant gesture, Jarvis can see what sir was looking at: "what does this say?",
"translate this", "add this to my calendar" are about the screen he summoned him over. Every such
summoning comes with a screenshot, sent to the Jarvis server, and looked at only when sir asks.

```
gesture       system ─ onHandleScreenshot(bitmap) ──▶ JarvisVoiceInteractionSession
              phone   scaled to 1600 px, JPEG in cache/jarvis-screenshots   (SummoningScreenshot.kt)
connected     phone ─ POST <server>/api/photos/slots {"conversationId": "conv_…", "kind": "screenshot"}
              phone ─ PUT image/jpeg to <server><uploadPath> ──▶ Jarvis server ──▶ { photoId }
              phone ─ contextual update ──▶ agent   "When sir summoned you, his phone took a screenshot
                                                     of what was on its screen (photo photo7)."
sir asks      agent ─ routePromptWorkflow "What does the message on his screen say? (photo photo7)"
```

- **The system takes it, and only when asked to.** The assistant gesture shows the session with
  `SHOW_WITH_SCREENSHOT`, and the system hands it the screen it came up over in `onHandleScreenshot`,
  as it does for any assistant — no permission is declared or held. It does so only while "Use
  screenshot" is on in the digital assistant's settings (on by default), and an app that marks its
  window secure arrives as none. The watch's summoning (`showSession(…, 0)`) asks for none.
- **It belongs to the summoning, and the camera does not end one.** `SummoningScreenshot.kt` numbers
  summonings and empties its own cache directory on each, so a screenshot still being written when
  the next comes is never handed to that one's conversation. The window brought back after a photo
  passes `BACK_FROM_THE_CAMERA`, so it keeps the screen the conversation was summoned over. A
  screenshot the system was asked for and never sent is given up on after five seconds.
- **It is sent once the conversation connects, through the photo's own route.** The slot is asked for
  with the conversation's id, so the server's live-conversation check stands in front of it as it
  does for a photo, and with `kind: "screenshot"`, so the server never treats it as a photo sir sent:
  it is never *waiting*, never brought up in a later reply, never stands in for "the latest photo",
  and it is kept for a day, as a photo is, counted apart from his photos rather than instead of
  them (`.claude/rules/mcp-vision-vertical.md`, "Vision"). Only the tree drawn in the assistant's window sends one (`useScreenshotSending`), and
  only with a server address.
- **The agent is told in a note, never a turn, and nothing is said when it fails.** Sir asked nothing
  about his screen, so `screenshotTaken` is a contextual update, and the prompt ("Photos") has the
  agent say nothing of it until he asks about something on his screen — then route the question with
  the screenshot named. A slot refused or an upload that failed is a line in the log and nothing more.
  `photo-messages.contract.spec.ts` holds the note to the prompt that quotes it, and
  `summoning-screenshot.contract.spec.ts` holds the Kotlin to the JavaScript.

What still needs a device: whether a given phone delivers the screenshot after `onShow` (AOSP
does), and whether its OEM leaves "Use screenshot" on by default.
