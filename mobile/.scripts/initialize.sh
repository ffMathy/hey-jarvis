#!/bin/bash
# Put the phone app's own copy of `canvaskit.wasm` in place.
#
# Skia does this in a postinstall, and postinstalls never run here
# (`ignoreScripts = true` in bunfig.toml). Nothing is downloaded: `setup-skia-web`
# only copies `canvaskit.wasm` out of a package `bun install` already fetched and
# locked, into `public/`, which the web export serves from its root. Without it
# the hologram cannot draw in a browser.
#
# The other half of Skia's setup — `install-skia`, which puts the prebuilt native
# libraries where the Gradle build links against them — is *not* here any more.
# It writes into the installed package rather than into this app, and the watch
# resolves the same copy, so the two apps running it at once corrupted it. It is
# now a single workspace-level task that both apps depend on; see
# `.scripts/install-skia.sh` for the failure it was extracted to fix.
set -euo pipefail

cd "$(dirname "$0")/.."

bunx setup-skia-web public
