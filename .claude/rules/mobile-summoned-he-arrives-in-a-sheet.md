---
paths:
  - "mobile/**"
---

# Summoned, he arrives in a sheet

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

The assistant gesture puts the conversation in the same bottom sheet sample mode uses
(`sample-sheet.tsx`), over whatever the user was doing, and he forms once it has stopped moving.
Opened from the launcher he still fills the screen: there is nothing underneath to keep.

It used to take the whole screen when summoned too, and nobody chose that — the sheet was only
ever written for sample mode, which is what a summoning showed before there were credentials, so a
phone that had been set up simply stopped seeing it. Tapping beside the sheet or pressing back hangs
up — at once, unless he is in the middle of a tool call. Then the sheet still goes at once and his
microphone is muted, but the call to ElevenLabs is held until the work is done (`hangUpAfterWork` in
`hologram/src/jarvis-session.ts`, which ends it the moment the sphere would stop thinking), so a
command is never cut off on its way just because sir dismissed him quickly. Summoned again before
then, that conversation is taken back, listening again, rather than replaced. The assistant's window is kept between summonings rather than rebuilt, so a summoning after he
has gone is announced by the session itself: every showing sets the surface's `showing` root prop
(`SHOWING_PROP`) to a new number, which brings the sheet back and opens a new conversation.

**The window going away hangs up too, whoever put it away.** The system hides it on its own: the
screen timing out over the lock screen does it, because `VoiceInteractionSession.onLockscreenShown`
is `hide()` by default. Holding the power button works with the phone locked and the screen off, so a
summoning from a pocket sat there talking, the screen slept, and the window went. The conversation did
not. Sir unlocked to Jarvis listening and answering, with no sheet and nothing to hang up with. Now
every hide except the camera's sends `onAssistantWindowPutAway` (`WINDOW_PUT_AWAY`, pinned by
`assistant-window.contract.spec.ts`), and the window's tree answers it with `hangUpAfterWork`, as
a dismissal. React Native is
paused two seconds later instead of at once. A paused instance stops its timers, and the hang-up
should not depend on one of them never firing. The activity's tree does not listen, for the reason
below.

**There are two apps on one JavaScript runtime, and a signal has to reach the right one.** The
assistant's window is a second React Native surface; the app's own activity is often still alive
from an earlier launch, behind whatever the user is doing, rendering its own tree. Anything that
belongs to the process rather than to a window reaches both. `AppState` is one — resuming React
Native for the window moves it to `active` in the activity's tree too — and it used to be how a
re-summoning was noticed, so the activity answered it as well, with a conversation nobody could see:
the greeting played and no sheet appeared, because the one greeting was underneath the current app.
`dismissAssistantWindow` is another, since it retracts whichever window is showing, and the
activity's conversation ending mid-summoning used to take the window down with it. Launch URLs are a
third. So a summoning into the window is its `showing` prop, a summoning into the activity is its
launch URL, the window's tree ignores launch URLs, and only the tree drawn in the window
(`summoned`, passed down as `inAssistantWindow`) may retract it.

**A session that fails once open also says so in a toast.** An account out of credits is
accepted, connects, and is then closed by ElevenLabs with `quota_exceeded` — which is a
conversation ending, so he fades and the sheet goes, and the red line went with it before anyone
could read it. Failures of the session itself — the session reports them with the source
`session`: a start that failed, an error before it opened, and `onDisconnect` with `reason: "error"`
— go through `reportSessionFailure`, which also shows them as an Android toast that outlives the
window. Problems before a session exists, and the deadline, stay on the line alone, under a sphere
that is still there. An error once the conversation is open is not a failure at all: it used to be,
through the SDK's React provider, which faded Jarvis out while his voice played on.

**Ending is not the same as never starting**, and both read `disconnected`. A conversation that
never opened has failed, and the answer to that is the line saying why *under a sphere that is
still there*. So `hologram/src/conversation-life.ts` folds the statuses rather than looking at the
current one, and only a conversation that was open can end. The statuses are the session's, which
come from the SDK's status callbacks alone and read `disconnected` once a summoning is over.
