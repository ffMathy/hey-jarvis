---
paths:
  - "mobile/**"
---

# Getting an APK onto a phone

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

The **Mobile APK** workflow (`.github/workflows/mobile-apk.yml`) builds one on every push to `main` and every pull request that touches the app — `mobile/**`, the lockfile, or the build configuration — and can be started by hand from the Actions tab. Open the run and download `jarvis-<commit>.apk` from its Artifacts; it is uploaded unzipped, so it is the APK itself. Artifacts are kept for 30 days.

It runs `build:apk` straight on the runner rather than in the dev container CI uses, because the runner image already has the Android SDK with its licences accepted. Three things about the APK worth knowing:

- **arm64-v8a only.** That is what phones run, and each extra ABI compiles every native module again. For an x86_64 emulator, build locally with `reactNativeArchitectures=x86_64`, or use `.scripts/verify-assistant-on-emulator.sh`, which does.
- **Signed with the Expo template's debug keystore**, the same well-known key everywhere. CI and local builds therefore install over each other, which is what side-loading wants — but anyone can sign an update with that key, so it is not a distribution build. Anything published goes through EAS (`eas.json`'s `production` profile) with a real key.
- **It is the release variant**: the JS bundle is embedded, no Metro and no development client, and nothing configured — the ElevenLabs API key and agent ID are typed into the settings screen on first run, as on any install.

To run it on a device (needs the Android SDK, which CI does not have):

```bash
bun run --cwd mobile native:prebuild   # generates android/ from app.config.ts + modules/
bun run --cwd mobile android           # builds and installs a development build
bun run --cwd mobile start             # Metro, for an already-installed development build
```

The prebuild script is called `native:prebuild` rather than `prebuild` deliberately: npm and bun treat `prebuild` as a lifecycle hook and run it automatically before `build`, which would put `expo prebuild` in front of every CI build — needing an Android SDK that CI does not have.

**Expo Go does not work.** The conversation needs LiveKit's native WebRTC modules and the assistant registration needs the native module in `modules/`, so a development build is the minimum.
