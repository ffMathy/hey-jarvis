---
paths:
  - "watch/**"
---

# Trying it on a Pixel Watch

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

1. Get the APK: the latest **Wear APK** run's artifact, or `bunx turbo build:apk --filter=watch`.
2. On the watch, turn on developer options (tap **Settings → System → About → Versions → Build number** seven times), then **Settings → Developer options → Wireless debugging**. The exact path can differ between releases.
3. Under Wireless debugging, choose **Pair new device** and pair from a computer on the same Wi-Fi: `adb pair <ip>:<pairing port>` with the code shown, then `adb connect <ip>:<port>`.
4. `adb install jarvis-watch-<commit>.apk`
5. On the watch: **Settings → Apps → Default apps → Digital assistant app → Default digital assistant app → Jarvis**, and confirm.
6. Hold the side button. Jarvis should come up and turn. With nothing handed over yet he is in sample mode — tap him to walk his moods — over the line **Open Jarvis on your phone**.
7. Open Jarvis on the phone — with the phone app installed and set up. The watch asks for the credentials every few seconds while it is waiting, and the phone answers as soon as it hears one, so this should be all it takes. If it is not, the phone's watch card has a **Send the key to <watch>** button; hold the phone's conversation screen to reach the settings it is on.
8. The watch should stop waiting and open a conversation by itself. Talk to him.

Once handed over, the credentials stay on the watch: step 7 is a one-off, and the watch works from then on with the phone out of range or switched off.

To put things back, choose Gemini again in the same place, and uninstall with `adb uninstall com.ffmathy.heyjarvis` — which, since the package name is shared, is also what removes the phone app if it is the phone that is connected, so check which device `adb devices` lists.
