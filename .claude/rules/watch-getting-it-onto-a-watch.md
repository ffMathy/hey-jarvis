---
paths:
  - "watch/**"
---

# Getting it onto a watch

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

`adb`, for now. There is no way around that until there is a Play listing, and it is worth knowing
why, because the phone app looks like it should be able to do it.

Most apps that offer "install on your watch" — Home Assistant among them — use
`RemoteActivityHelper` to start an activity on the paired watch, and the activity they start is the
watch's own Play Store, showing their listing. The user taps install *there*. That is as far as
Android allows: the package installer has to run on the watch, and the only thing that can be
started remotely is a browsable link. The one mechanism that genuinely pushed an APK across — an
APK embedded in the phone app for Play Services to deliver — was removed with Wear OS 1.

The phone app has the whole of that built (`mobile/modules/jarvis-watch` and `watch-card.tsx`): it
finds the paired watch over the Data Layer, says whether Jarvis is on it, and has the button. The
button is behind `JARVIS_IS_ON_PLAY`, which is false, because there is nothing for it to open yet.
An **internal testing track** is enough to flip it — a private listing, up to a hundred testers by
invitation, and none of the twelve-testers-for-fourteen-days that gates production. It would also
settle the signing question on its own, since Play signs both APKs with one key, which is what the
Data Layer requires before these two will speak to each other at all.
