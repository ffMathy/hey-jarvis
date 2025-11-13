# Fix for Release Please - Missing Tag for v0.7.0

## Problem Summary
Release Please is currently blocked and showing this error:
```
⚠ There are untagged, merged release PRs outstanding - aborting
```

## Root Cause
PR #155 was successfully merged on November 8, 2025, which released `home-assistant-voice-firmware v0.7.0`. The PR updated:
- `.github/.release-please-manifest.json` → set version to `0.7.0`
- `home-assistant-voice-firmware/CHANGELOG.md` → added release notes

However, the Git tag `home-assistant-voice-firmware-v0.7.0` was never created. Release Please requires the tag to exist before it will create new release PRs.

## Required Action
**Create the missing Git tag** `home-assistant-voice-firmware-v0.7.0` pointing to commit `46551d0afc564d58100c645e0af059af74682129`.

### Option 1: GitHub UI (Easiest)
1. Navigate to: https://github.com/ffMathy/hey-jarvis/releases/new
2. Fill in the form:
   - **Choose a tag**: `home-assistant-voice-firmware-v0.7.0` (create new tag)
   - **Target**: Select commit `46551d0afc564d58100c645e0af059af74682129`
   - **Release title**: `home-assistant-voice-firmware 0.7.0`
   - **Description**:
     ```markdown
     ## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.6.0...home-assistant-voice-firmware-v0.7.0) (2025-11-08)


     ### Features

     * **notification:** add proactive notification workflow with ElevenLabs integration ([9bc4bfd](https://github.com/ffMathy/hey-jarvis/commit/9bc4bfd4a9f1cf450c506219ea720c384f00d471))


     ### Documentation

     * add comprehensive documentation and improve notification tool ([97fe5ce](https://github.com/ffMathy/hey-jarvis/commit/97fe5ce28db180dc799d0858bae8f61874aa69c9))
     ```
3. Click **"Publish release"**

### Option 2: GitHub CLI
```bash
gh release create home-assistant-voice-firmware-v0.7.0 \
  --repo ffMathy/hey-jarvis \
  --target 46551d0afc564d58100c645e0af059af74682129 \
  --title "home-assistant-voice-firmware 0.7.0" \
  --notes "## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.6.0...home-assistant-voice-firmware-v0.7.0) (2025-11-08)


### Features

* **notification:** add proactive notification workflow with ElevenLabs integration ([9bc4bfd](https://github.com/ffMathy/hey-jarvis/commit/9bc4bfd4a9f1cf450c506219ea720c384f00d471))


### Documentation

* add comprehensive documentation and improve notification tool ([97fe5ce](https://github.com/ffMathy/hey-jarvis/commit/97fe5ce28db180dc799d0858bae8f61874aa69c9))"
```

### Option 3: Git Commands
```bash
git fetch origin
git tag -a home-assistant-voice-firmware-v0.7.0 46551d0afc564d58100c645e0af059af74682129 \
  -m "chore: release home-assistant-voice-firmware 0.7.0"
git push origin home-assistant-voice-firmware-v0.7.0
```

## Verification
After creating the tag:
1. Go to https://github.com/ffMathy/hey-jarvis/tags and verify `home-assistant-voice-firmware-v0.7.0` is listed
2. Trigger the release workflow manually or push a new commit to `main`
3. Check the workflow logs - Release Please should no longer show the "untagged" error
4. New release PRs should now be created normally

## Technical Details
- **Commit SHA**: `46551d0afc564d58100c645e0af059af74682129`
- **Commit Date**: Sat Nov 8 08:10:50 2025 +0000
- **Commit Author**: github-actions[bot]
- **Commit Message**: "chore: release"
- **Files Modified**:
  - `.github/.release-please-manifest.json`
  - `home-assistant-voice-firmware/CHANGELOG.md`

## Why This Happened
The release workflow (`.github/workflows/release.yml`) should automatically create a Git tag when a release PR is merged. However, for PR #155, either:
1. The workflow didn't run after the merge, or
2. The workflow ran but failed to create the tag

This left the repository in an inconsistent state where the manifest shows v0.7.0 but the Git tag doesn't exist.

## Prevention
To prevent this in the future:
- Monitor the release workflow runs after merging release PRs
- Verify that Git tags are created for each release
- Consider adding a check in the workflow to create missing tags automatically

## Cleanup
Once the tag is created and verified, this file can be deleted.
