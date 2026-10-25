---
paths:
  - "watch/**"
---

# What has been verified

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

Everything below was verified against the Kotlin prototype this app replaced. The registration it tested is the same registration `app.config.ts` now writes — the same two actions on the app's one activity — but it has **not** been re-run against the Expo build, and the activity's name changed with it (`.MainActivity`, not `.wear.AssistActivity`). Treat the first list as strong evidence rather than as a current pass.

On 2026-09-15, on emulators of both current Wear OS releases — `system-images;android-37.0;android-wear-signed;x86_64` (Wear OS 7, Android 17, what Pixel Watch 2–4 run since June 2026) and `android-36.1;android-wear-signed` (Wear OS 6.1) — both `user` builds with release keys, in the `wearos_large_round` profile. The same results on both:

- **Settings → Apps → Default apps → Digital assistant app** exists. Before install nothing handles `ASSIST` and the role is empty; after install Jarvis is the only handler.
- Tapping **Default digital assistant app** lists `None` and `Jarvis`. Choosing Jarvis asks for confirmation ("Change your digital assistant app to Jarvis?" on 7), and accepting it makes `com.ffmathy.heyjarvis` the `android.app.role.ASSISTANT` holder and `.MainActivity` the secure `assistant` setting.
- From the launcher, with Jarvis force-stopped first, `KEYCODE_ASSIST` brings the app to the front with `ASSIST`.
- **Holding the side button** (`KEYCODE_STEM_PRIMARY`, long press) — the Pixel Watch's assistant gesture — does the same.
- A short press of the side button opens Recents and does not start Jarvis, so it is the long press that is routed, not any press.

Not yet verified, and only a real watch can say:

- **With Gemini installed.** The emulator images ship no assistant, so the picker listed only Jarvis. A Pixel Watch lists Gemini too; choosing Jarvis should replace it, but that has not been seen.
- **The physical button.** The emulator's long press arrived as two `ASSIST` starts a moment apart, where the key event arrived as one. It may be how the emulator injects a long press; the real app has to treat a repeat as the same summoning either way, as the phone app's `createAssistLaunchClaim` already does.
- **The handover, and the conversation.** Both are new and neither has run on hardware. They typecheck, the four spellings of the two message paths are checked against each other by a test, and CI compiles the Kotlin on every push — and none of that is the same as two devices in the same room. What a real pair would settle, in order: whether the phone's `CapabilityClient` lookup finds the watch when the watch app has never been opened; whether Play Services starts `JarvisPhoneListenerService` for a message on that path with the app force-stopped; whether `EncryptedSharedPreferences` survives a watch reboot; and whether a Wear OS microphone gives WebRTC enough to hold a conversation with, which is the one question none of the code can answer.
- **Whether the GPU body draws on a watch at all.** Whether its GPU gives OpenGL ES 3 — the first Pixel Watch's Mali-T720 may not, and would then show him without a body — whether expo-gl's worklet support draws from the UI thread there, and what two `TextureView`s and the GPU's passes cost the watch. The waiting screen's readout says how fast he is drawn, and how many sparks.
