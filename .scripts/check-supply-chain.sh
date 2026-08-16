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
# 4. GitHub Actions are pinned to immutable commit SHAs.
# ---------------------------------------------------------------------------
unpinned_actions=$(git ls-files -- '.github/workflows/*.yml' '.github/workflows/*.yaml' |
	xargs grep -nE '^[[:space:]]*(-[[:space:]]*)?uses:' 2>/dev/null |
	grep -vE 'uses:[[:space:]]*\./' |
	grep -vE 'uses:[[:space:]]*[^@]+@[0-9a-f]{40}([[:space:]]|$|#)' || true)
if [ -n "$unpinned_actions" ]; then
	fail "GitHub Actions must be pinned to a full commit SHA:"
	echo "$unpinned_actions" | sed 's/^/     /'
else
	pass "All GitHub Actions are pinned to commit SHAs"
fi

# ---------------------------------------------------------------------------
# 5. No floating tags in MCP server commands or container images.
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
