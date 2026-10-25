---
paths:
  - "watch/**"
---

# What is in here

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

```
watch/
├── app.config.ts                 # Expo config: the watch feature, the assistant filter, the capability
├── index.ts                      # registerRootComponent
├── modules/jarvis-phone/         # the local Expo module that hears the phone
│   ├── index.ts                  # the JS side
│   └── android/src/main/         # Kotlin, and the library manifest declaring the listener service
├── modules/jarvis-network/       # Wi-Fi or cellular for a conversation, off the phone's Bluetooth
├── modules/jarvis-volume/        # the call volume, brought down to 90% before he speaks
└── src/
    ├── app.tsx                   # two states: a conversation, or waiting for the phone
    ├── conversation-screen.tsx   # the sphere, and a live ElevenLabs session behind it
    ├── waiting-for-the-phone.tsx # sample mode while it waits, and one line saying what is missing
    ├── phone-settings.ts         # the credentials, and the asking that gets them
    ├── phone-mirror.ts           # the phone's sphere, drawn here while the phone holds the conversation
    ├── microphone-permission.ts  # PermissionsAndroid
    ├── watch-density.ts          # the watch's pace, and letting the drawing find its own count (the ceiling is `WATCH_PARTICLE_COUNT`, in `hologram`)
    └── watch-screen.ts           # how big the sphere is drawn on a round screen
```
