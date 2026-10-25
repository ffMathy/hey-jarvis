# Supply Chain Security

Dependencies are the most likely way an attacker gets code into this repository,
so installation is locked down. The rules below are checked by
`.scripts/check-supply-chain.sh`, run on demand with `bun run check:supply-chain`.
It is no longer wired into CI, so nothing enforces these rules automatically —
run it yourself when touching dependencies or workflows.

## Bun is the only package manager

`npm`, `npx`, `yarn` and `pnpm` are not allowed anywhere — not in scripts, not in
workflows, not in Dockerfiles. A second package manager resolves dependencies
outside `bun.lock`'s pins and ignores `bunfig.toml`. Use `bun` and `bunx`; a
committed `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` fails CI and the
pre-commit hook.

## Install policy (`bunfig.toml`)

| Setting                        | Effect                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `exact = true`                 | Versions are pinned exactly — never `^` or `~`                       |
| `ignoreScripts = true`         | Dependency lifecycle scripts (`postinstall` & friends) never execute |
| `minimumReleaseAge = 604800`   | Only versions public for ≥ 7 days can be resolved                    |
| `saveTextLockfile = true`      | Dependency changes stay reviewable in diffs                          |
| `registry = …registry.npmjs.org` | Installs cannot be silently redirected to another host             |

Nothing updates dependencies automatically: Dependabot, and the job that
auto-merged its pull requests, were removed in `1ca5f2b` (`ci: remove
dependabot`). Every bump is made by hand with `bun add` or `bun update`, and the
7-day `minimumReleaseAge` applies to it, so new versions still sit out the window
that malicious releases are typically caught and yanked in.

The one exception is GitHub's Dependabot *security* updates, a repository setting
that runs on every push to `main`. `.github/dependabot.yml` exists only so they run
under the `bun` ecosystem — as `npm_and_yarn` they refused a repository with only a
`bun.lock`, and every run failed. Its version updates are off
(`open-pull-requests-limit: 0`) and its cooldown matches the 7-day window, so all
it ever does is open a pull request for a vulnerable direct dependency, which is
reviewed and merged like any other.

## Adding or updating a dependency

```bash
bun add <package>            # writes an exact version
bun install --frozen-lockfile # what CI and containers run
bun run check:supply-chain   # the policy check, which CI no longer runs for you
bun run audit                # known advisories, high severity and above
```

A brand-new release (< 7 days old) is refused by design. Wait it out, or — if a
security fix makes waiting worse than installing — add the package to
`minimumReleaseAgeExcludes` in `bunfig.toml` in the same pull request, so the
exception is reviewed.

The cooldown also applies when re-resolving, so a plain `bun update` fails while
any pinned version is younger than 7 days ("failed to resolve"). For a one-off,
relax it on the command line — `bun update --minimum-release-age=86400` — and
check the resulting `bun.lock` diff before committing it.

## Overriding a vulnerable transitive dependency

When a package deep in the tree has an advisory but its parent still requests a
vulnerable range, pin it forward in the `overrides` block of `package.json`.
Two things to know before adding one:

- **Bun only honors flat overrides.** The npm nested form
  (`{"parent": {"child": "1.2.3"}}`) is parsed and then silently ignored, so a
  nested entry looks like a fix while doing nothing. Always re-run
  `bun run audit` to confirm an override actually took effect.
- **An override applies to every copy in the tree.** If two majors of a package
  are installed, all consumers get the one version you name. Check the consumers
  with `bun why <package>` first — forcing a major on a consumer that expects the
  old API breaks it at runtime, not at install time.

Advisories that cannot be fixed this way are listed below with the consumer that
blocks them, so nobody has to re-derive it:

| Package           | Blocked by                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `brace-expansion` | Only safe version is ESM-only; `minimatch@3` (via `serve-handler`) is CJS |
| `js-yaml`         | `gray-matter` calls `safeLoad`/`safeDump`, removed in v4            |
| `minimatch`       | `serve-handler` calls the CJS export as a function; v9+ exports an object |
| `path-to-regexp`  | Same — `serve-handler` calls `pathToRegExp(...)` directly           |

Three of those trace to `serve-handler` ← `serve` ← the `mastra` CLI, so a single
upstream bump there would clear them.

## Install scripts are never trusted

Because `ignoreScripts = true` applies to this workspace too, `prepare` does not
run on install. Git hooks are installed explicitly instead:

```bash
bun run prepare   # git config core.hooksPath .husky
```

Native binaries come from optional platform packages or from an explicit,
reviewable `initialize` target — never from a `postinstall`. Do not reintroduce
`trustedDependencies`.

## GitHub Actions

Every `uses:` is pinned through `.github/workflows/actions.lock`, which records
the commit each tag resolved to; GitHub runs that commit, so a retagged action
cannot slip in under the workflow's token. Regenerate the lockfile with
`gh actions-lock` after adding or bumping an action — never rewrite the `uses:`
lines to bare SHAs by hand, which desynchronises them from the lockfile and
makes GitHub reject every workflow in the repository. Workflows default to
`permissions: {}` and opt into the minimum they need, and checkouts use
`persist-credentials: false` so project code never inherits a usable token.

Every job must run on a GitHub-hosted runner (`ubuntu-*`, `windows-*`,
`macos-*`). Self-hosted runners execute workflow code on a machine we control,
where a malicious pull request could read other jobs' secrets, poison the tool
cache, or persist between runs. Registering one already requires repository
admin; the CI check makes the other half explicit by rejecting any workflow that
targets a runner we do not rent from GitHub.

The `OP_SERVICE_ACCOUNT_TOKEN` that unlocks the whole `Jarvis` vault is kept out
of `CI`, which compiles the firmware and runs `turbo test` over untrusted pull
request code on every push: that workflow is given no vault token at all, and the
integration tests that would need one do not run on GitHub Actions (see
[Unit Tests vs Integration Tests](validation.md#unit-tests-vs-integration-tests)). The workflows that do carry it are
`Release`, which runs only on `main`, and `Play`, which needs the upload key and
runs only when `Release` calls it (or someone starts it by hand).

