#!/bin/bash
# Verifies that the repository's supply chain policy is actually in force.
# Run locally with `bun run check:supply-chain`; CI runs it on every pull
# request. See AGENTS.md → Supply Chain Security for the policy itself.

set -uo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
	echo "❌ $1"
	failures=$((failures + 1))
}

pass() {
	echo "✅ $1"
}

# ---------------------------------------------------------------------------
# 1. Bun is the only package manager.
# ---------------------------------------------------------------------------
foreign_lockfiles=$(git ls-files |
	grep -E '(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$' |
	while read -r lockfile; do [ -e "$lockfile" ] && echo "$lockfile"; done || true)
if [ -n "$foreign_lockfiles" ]; then
	fail "Foreign lockfiles are committed (Bun is the only supported package manager):"
	echo "$foreign_lockfiles" | sed 's/^/     /'
else
	pass "No npm/yarn/pnpm lockfiles are committed"
fi

if [ ! -f bun.lock ]; then
	fail "bun.lock is missing — dependency resolution is not pinned"
else
	pass "bun.lock is present"
fi

# `npm install`/`npx`/`yarn`/`pnpm` invocations reintroduce a second resolver
# that ignores bun.lock and bunfig.toml. Scripts and workflows must use Bun.
npm_invocations=$(git ls-files -- '*.sh' '*.yml' '*.yaml' '*.json' '*.ts' '*.js' 'Dockerfile*' |
	grep -vE '(^|/)(package.json|bun.lock)$' |
	xargs grep -nE '(^|[^A-Za-z0-9_/.-])(npm (install|ci|run|exec)|npx |yarn |pnpm )' 2>/dev/null |
	grep -v 'check-supply-chain.sh' || true)
if [ -n "$npm_invocations" ]; then
	fail "Non-Bun package manager invocations found:"
	echo "$npm_invocations" | sed 's/^/     /'
else
	pass "All package manager invocations use Bun"
fi

# ---------------------------------------------------------------------------
# 2. Install policy is configured.
# ---------------------------------------------------------------------------
require_bunfig() {
	local key="$1" expected="$2"
	local actual
	actual=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" bunfig.toml | head -1 |
		sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*(#.*)?$//')
	if [ "$actual" != "$expected" ]; then
		fail "bunfig.toml: expected ${key} = ${expected} (found '${actual:-nothing}')"
	else
		pass "bunfig.toml: ${key} = ${expected}"
	fi
}

require_bunfig exact true
require_bunfig ignoreScripts true
require_bunfig minimumReleaseAge 604800

# Lifecycle scripts stay disabled globally, so no package may be re-trusted.
if grep -q '"trustedDependencies"' package.json; then
	fail "package.json declares trustedDependencies — install scripts must stay disabled"
else
	pass "No package is trusted to run install scripts"
fi

# ---------------------------------------------------------------------------
# 3. Every dependency is pinned to an exact version.
# ---------------------------------------------------------------------------
# `engines` and `peerDependencies` are declarations *about* compatibility, so
# ranges there are expected; installed dependency versions must be exact.
unpinned=$(git ls-files -- 'package.json' '*/package.json' | while read -r manifest; do
	bun --eval "
		const manifest = require('./${manifest}');
		for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']) {
			for (const [name, range] of Object.entries(manifest[section] ?? {})) {
				if (!/^[0-9]/.test(range)) console.log('${manifest}: ' + section + '.' + name + ' = ' + range);
			}
		}
	"
done)
if [ -n "$unpinned" ]; then
	fail "Dependency ranges found — every version must be exact:"
	echo "$unpinned" | sed 's/^/     /'
else
	pass "All dependencies are pinned to exact versions"
fi

# ---------------------------------------------------------------------------
# 4. Every GitHub Action is pinned to an immutable commit SHA by the lockfile.
# ---------------------------------------------------------------------------
# The pinning lives in .github/workflows/actions.lock, not inline in the workflows.
# GitHub resolves each `uses:` through that lockfile, so a tag reference still runs
# the exact commit recorded there, and a hijacked tag is caught before it runs.
#
# This check used to demand a bare SHA on every `uses:` line instead. That is
# actively worse under the lockfile model: `gh actions-lock` reports a bare SHA as
# "pinned to a bare SHA without a symbolic ref — weakens supply-chain traceability",
# because the SHA alone says nothing about which release it is. Worse, rewriting the
# workflows to SHAs desynchronised them from the lockfile, which GitHub then rejected
# outright with "Invalid lockfile: the lockfile could not be validated" -- a startup
# failure that stopped every workflow from running at all.
#
# So verify what actually matters: the lockfile exists, and it accounts for every
# action referenced by every workflow. Deliberately offline and dependency-free --
# `gh actions-lock --no-fix` is the richer check, but it needs the extension and
# network access, and this script must stay runnable anywhere.
actions_lock='.github/workflows/actions.lock'
if [ ! -f "$actions_lock" ]; then
	fail "Missing $actions_lock — generate it with: gh actions-lock"
else
	unlocked_actions=$(git ls-files -- '.github/workflows/*.yml' '.github/workflows/*.yaml' |
		xargs grep -nE '^[[:space:]]*(-[[:space:]]*)?uses:' 2>/dev/null |
		grep -vE 'uses:[[:space:]]*\./' |
		while IFS= read -r line; do
			# "path:lineno:  uses: owner/repo@ref  # comment" -> "owner/repo@ref"
			ref=$(printf '%s\n' "$line" | sed -E 's/.*uses:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//')
			# A ref already pinned to a bare SHA needs no lockfile entry to be immutable.
			printf '%s\n' "$ref" | grep -qE '@[0-9a-f]{40}$' && continue
			grep -qF "'${ref}'" "$actions_lock" || printf '%s\n' "$line"
		done)
	if [ -n "$unlocked_actions" ]; then
		fail "GitHub Actions missing from $actions_lock (run: gh actions-lock):"
		echo "$unlocked_actions" | sed 's/^/     /'
	else
		pass "All GitHub Actions are pinned via $actions_lock"
	fi
fi

# ---------------------------------------------------------------------------
# 5. Jobs only run on GitHub-hosted runners.
# ---------------------------------------------------------------------------
# A self-hosted runner executes workflow code on a machine we control, where a
# malicious pull request could read other jobs' secrets, poison the tool cache
# or persist between runs. Registering one needs repository admin, but this
# check makes the other half explicit: even if a runner existed, no workflow
# here is allowed to target it.
foreign_runners=$(git ls-files -- '.github/workflows/*.yml' '.github/workflows/*.yaml' |
	xargs grep -nE '^[[:space:]]*runs-on:' 2>/dev/null |
	grep -vE 'runs-on:[[:space:]]*(ubuntu|windows|macos)-[a-z0-9.-]+[[:space:]]*$' || true)
if [ -n "$foreign_runners" ]; then
	fail "Workflows must run on GitHub-hosted runners:"
	echo "$foreign_runners" | sed 's/^/     /'
else
	pass "All workflow jobs run on GitHub-hosted runners"
fi

# ---------------------------------------------------------------------------
# 6. No floating tags in MCP server commands or container images.
# ---------------------------------------------------------------------------
floating=$(git ls-files -- '*.json' 'Dockerfile*' '*/Dockerfile*' |
	xargs grep -nE '@latest|FROM .*:latest' 2>/dev/null || true)
if [ -n "$floating" ]; then
	fail "Floating 'latest' references found — pin an exact version:"
	echo "$floating" | sed 's/^/     /'
else
	pass "No floating 'latest' references"
fi

echo
if [ "$failures" -gt 0 ]; then
	echo "❌ Supply chain check failed with ${failures} problem(s)."
	exit 1
fi

echo "✅ Supply chain check passed."
