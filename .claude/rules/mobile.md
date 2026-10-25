---
paths:
  - "mobile/**"
---

# Mobile App

> Paths in this rule are relative to `mobile/` unless they say otherwise.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Getting an APK onto a phone](mobile-getting-an-apk-onto-a-phone.md)
- [How it fits together](mobile-how-it-fits-together.md)
- [File Structure](mobile-file-structure.md)
- [The hologram](mobile-the-hologram.md)
- [Showing him something](mobile-showing-him-something.md)
- [Sample mode](mobile-sample-mode.md)
- [First run](mobile-first-run.md)
- [Configuration](mobile-configuration.md)
- [Handing the credentials to the watch](mobile-handing-the-credentials-to-the-watch.md)
- [What was on the screen](mobile-what-was-on-the-screen.md)
- [Becoming the assistant](mobile-becoming-the-assistant.md)
- [Dependencies](mobile-dependencies.md)
- [Web](mobile-web.md)
- [Testing](mobile-testing.md)

## Overview

An Expo app that registers as the phone's **default digital assistant** on Android, replacing Gemini or Google Assistant, and answers as Jarvis over a live ElevenLabs voice conversation. It also builds for web, where the conversation works and the assistant role does not.

No iOS target: Apple does not let an app replace Siri, so it would ship something that cannot do the one thing this project exists for.

## TURBO Commands

```bash
bunx turbo lint --filter=mobile       # Biome
bunx turbo typecheck --filter=mobile  # tsgo
bunx turbo test --filter=mobile       # the offline suite
bunx turbo build --filter=mobile      # bundles the JS for Android into dist/mobile
bunx turbo build:apk --filter=mobile  # installable arm64 release APK into dist/mobile-apk (needs JDK + Android SDK)
bunx turbo e2e --filter=mobile        # exports for web and drives it in Chromium
```

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
