# GitHub Actions Security

> Part of [Supply Chain Security](supply-chain-security.md).

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
[Unit Tests vs Integration Tests](validation-unit-tests-vs-integration-tests.md#unit-tests-vs-integration-tests)). The workflows that do carry it are
`Release`, which runs only on `main`, and `Play`, which needs the upload key and
runs only when `Release` calls it (or someone starts it by hand).
