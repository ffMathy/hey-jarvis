---
paths:
  - "mobile/**"
---

# Becoming the assistant

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Registration is entirely declarative, and every piece of it is load-bearing. `modules/jarvis-assistant/android/src/main/AndroidManifest.xml` is a *library* manifest that the Android build merges into the app's own, which is why there is no config plugin for any of this.

What has to be true, or the app silently never appears in the picker:

- The `VoiceInteractionService` is `exported="true"` and requires `android.permission.BIND_VOICE_INTERACTION`. The system process binds it across UIDs; `exported="false"` fails the bind with nothing logged in the app.
- The same goes for the session service.
- `res/xml/jarvis_voice_interaction_service.xml` names **both** a `sessionService` and a `recognitionService`. A missing `recognitionService` is still a hard parse error on current Android, and on API 29–30 the named class is copied into the device-wide speech recogniser setting — so `JarvisRecognitionService` has to exist and be instantiable even though it recognises nothing.
- `supportsAssist="true"` produces no error when missing and quietly downgrades the app to the plain assist-intent path.

Two things Android does **not** allow, both of which look like they work in code:

- `RoleManager.createRequestRoleIntent(ROLE_ASSISTANT)` shows no dialog. The role is declared not requestable, so the activity finishes immediately. The app sends the user to `Settings.ACTION_VOICE_INPUT_SETTINGS` instead, and re-reads the role when it comes back to the foreground. The last step of the first-run tour is where that is offered, and it says what to tap once it lands — which screen it manages to reach differs by device, so the directions change with it.
- Calling `hide()` before `startAssistantActivity()` makes the start illegal: what it checks is that the session is currently shown, and `hide()` retracts it. Start the activity first, hide second. Suppressing the session's own window with `setUiEnabled(false)` in `onPrepareShow` is fine and is what AOSP recommends for a session that only launches an activity — it is a client-side flag and does not make the session un-shown — but nothing may ask for a content view afterwards.

To debug a device where Jarvis does not appear in the picker:

```bash
adb logcat -s VoiceInteractionServiceInfo   # names the exact parse error
adb shell cmd role get-role-holders android.app.role.ASSISTANT
```
