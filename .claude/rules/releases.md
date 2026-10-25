# Releases

`Release` runs on every push to `main`, and every push is a release of the
commit it pushed. There is no release pull request and nothing is committed
back to `main`: a release is a tag and a GitHub Release, nothing more, so
`GITHUB_TOKEN` is all it needs and branch protection never gets in its way.

`.scripts/release.js` works it out. It finds the last `root-v*` tag behind the
pushed commit, reads the conventional commits since it, and raises the version
by them — `feat` the minor, a `!` or a `BREAKING CHANGE:` footer the major, and
everything else the patch. Every commit releases: a type with no section of its
own, or a commit that is not conventional at all, still bumps the patch and is
listed under "Other changes". Only the subject line is parsed, so nothing in a
squash commit's body — the pull request description — can stop a release. The
`root-v` prefix is kept from the Release Please days, so the tags it cut are the
history this continues from.

The notes on the GitHub Release are the changelog, grouped by type in the shape
Release Please used to write them, with each commit linked and the comparison
with the previous release in the heading. The `CHANGELOG.md` files are no longer
written; they keep the history of the Release Please releases, and the
Releases page has everything after. Likewise the `version` fields in the `package.json` files no
longer move — nothing reads them for a release.

The version reaches what ships as `RELEASE_VERSION`: `deploy` tags the MCP
image with it (`mcp/.scripts/deploy.sh`, which refuses to run without it), and
`play` passes it to the `Play` workflow, where it becomes both apps' version
name. Every package is released under that one version.

The runs queue under the workflow's `concurrency` group, and GitHub keeps only
the newest queued run. If merges land faster than a release and its deploy
finish, the run for the newest of them releases them all together — it counts
everything since the last tag — rather than one release each.

To hold a release back, hold the commits back: anything that lands on `main`
ships on the next run.

A release ships the phone, the watch and the web build too. Once the release is
tagged, the `play` job hands the released commit to the `Play` workflow and the
`pages` job hands it to `Mobile Web`, which publishes to GitHub Pages. Those are
the only automatic ways into Play or the root of the Pages site: branch pushes
publish nothing to Play. A pull request still builds the phone and watch APKs
(`Mobile APK`, `Wear APK`) and keeps them as run artifacts, so the build is
exercised before it is released without anything reaching testers.

Every pull request from a branch of this repository also gets its own copy of
both web builds — the phone app and the Quest app — through `Web Preview`, at
`https://ffmathy.github.io/hey-jarvis/pr/<n>/` (and `…/pr/<n>/vr/`). One comment
on the pull request links it and is updated in place (`.scripts/upsert-pr-comment.sh`), every push rebuilds it, and closing the pull
request takes it down. The release at the root is never touched by a preview.
For that to work Pages serves the `gh-pages` branch (Settings → Pages → *Deploy
from a branch*, `gh-pages`, `/ (root)`) rather than an uploaded artifact, which
would replace every preview on each deploy; `.scripts/publish-pages.sh` writes
each part of that branch without disturbing the others.

It publishes to the **closed test** (`alpha`), not production. Production is not
open to a personal developer account until it has run a closed test with twelve
testers for fourteen days, and 2.2.0 proved it: Play took the bundle and refused
to commit the release with a bare `Precondition check failed.` So the closed
track is both where a release can go today and how production eventually gets
earned. The watch stays on `wear:internal`, because no Wear OS closed track
exists — the API's own track list has no `wear:alpha`.

Both numbers on a bundle come from outside the app configs: the version name is
the release's version, handed in as `RELEASE_VERSION`, and the version code is
seconds since 2025-01-01, which is the one clock both entry points can share
without eventually colliding. `docs/play-store.md` §9 has the tracks, the gates
and the failure.

