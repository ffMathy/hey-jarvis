---
paths:
  - "vr/**"
---

# Publishing: GitHub Pages, shared with the phone

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`.github/workflows/mobile-web.yml` builds this package (`bunx turbo build
--filter=vr`) before the phone's web export, assembles one site — the phone
app at the root, `dist/vr` in `vr/` — and publishes it. Vite's
`base: './'` makes every asset URL relative, so the same build works at any
sub-path and needs no base-path variable.

**The root is the release; each pull request has a folder of its own.**
`release.yml` calls the workflow with the released commit once it has tagged
the release, and it publishes to `/hey-jarvis/` and `/hey-jarvis/vr/`.
`web-preview.yml` calls it for every push to a pull request from a branch of
this repository, with `subpath: pr/<n>`, so that pull request's build is at
`/hey-jarvis/pr/<n>/vr/` — the same build at a different sub-path, which the
relative `base` makes possible — and comments the link on the pull request.
Closing the pull request removes the folder. Fork pull requests get no preview.

Pages serves the `gh-pages` branch, not an uploaded artifact: an artifact is the
whole site, so each preview would have replaced the release and every other
preview. `.scripts/publish-pages.sh` rewrites only its own part of the branch —
the root around `pr/`, or one `pr/<n>/` — keeps the branch at a single commit so
the wasm and models in every preview do not pile up in its history, and retries
when another run pushed first. A preview shares the release's origin and so its
`localStorage`: the ElevenLabs settings saved in one are there in all of them.
A manual run of **Mobile Web** republishes the root from whichever branch it is
started on.
