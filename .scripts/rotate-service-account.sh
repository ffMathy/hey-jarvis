#!/usr/bin/env bash
set -euo pipefail

# Rotate the 1Password service account used for unattended access to the
# `Jarvis` vault (local agent runs and CI).
#
# NOTE ON "AUTOMATIC" ROTATION
# ----------------------------
# This cannot be fully unattended. A service account is not allowed to mint its
# own replacement, so rotation always needs a credential with more authority than
# the one being rotated. Automating it would mean parking an owner-level
# credential somewhere permanent, which is strictly worse than the token it
# replaces.
#
# What this script does instead:
#   * issues a SHORT-LIVED token (--expires-in), so an unnoticed leak dies on its own
#   * makes rotation a single command, so doing it often is cheap
#   * pushes the new token straight to the GitHub secret, so CI never drifts
#   * stores the token in 1Password, never on disk or in scrollback
#
# Usage:
#   bash .scripts/rotate-service-account.sh            # rotate now
#   EXPIRES_IN=30d bash .scripts/rotate-service-account.sh
#   bash .scripts/rotate-service-account.sh --check    # report time left, rotate nothing

VAULT="${VAULT:-Jarvis}"
EXPIRES_IN="${EXPIRES_IN:-90d}"
ACCOUNT_PREFIX="${ACCOUNT_PREFIX:-hey-jarvis-agent}"
REPO="${REPO:-ffMathy/hey-jarvis}"
# Kept in Personal on purpose: service accounts cannot read Personal, so a leaked
# token can't be used to fetch its own successor.
TOKEN_ITEM="${TOKEN_ITEM:-1Password service account (Jarvis)}"
TOKEN_VAULT="${TOKEN_VAULT:-Personal}"

require_human_session() {
  # A service account rotating itself is the exact bootstrap problem this guards.
  if [ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
    echo "❌ OP_SERVICE_ACCOUNT_TOKEN is set in this shell."
    echo "   A service account cannot create its own replacement. Run as yourself:"
    echo "     unset OP_SERVICE_ACCOUNT_TOKEN && eval \$(op signin)"
    exit 1
  fi

  if ! op account get &> /dev/null; then
    echo "❌ Not signed in to 1Password - run: eval \$(op signin)"
    exit 1
  fi
}

if [ "${1:-}" = "--check" ]; then
  require_human_session
  if expires_at=$(op item get "$TOKEN_ITEM" --vault "$TOKEN_VAULT" --fields expires_at 2>/dev/null) \
     && [ -n "$expires_at" ]; then
    echo "ℹ️  Current token expires at: $expires_at"
    echo "   Rotate with: bash .scripts/rotate-service-account.sh"
  else
    echo "⚠️  No recorded expiry found in '$TOKEN_ITEM' ($TOKEN_VAULT vault)."
    echo "   Either it has never been rotated by this script, or the item is missing."
  fi
  exit 0
fi

require_human_session

timestamp="$(date +%Y%m%d-%H%M%S)"
account_name="${ACCOUNT_PREFIX}-${timestamp}"

echo "🔑 Creating service account '${account_name}'"
echo "   vault:   ${VAULT} (read_items only)"
echo "   expires: ${EXPIRES_IN}"

# --raw emits only the token. It is held in a shell variable and piped onward;
# it is never echoed, written to a file, or passed as a command-line argument
# (argv is visible to other processes via the process list).
token="$(op service-account create "$account_name" \
  --expires-in "$EXPIRES_IN" \
  --vault "${VAULT}:read_items" \
  --raw)"

if [ -z "$token" ]; then
  echo "❌ 1Password returned an empty token; aborting without changing anything."
  exit 1
fi

# 1Password only ever returns this token once, so persist it before anything else.
if op item get "$TOKEN_ITEM" --vault "$TOKEN_VAULT" &> /dev/null; then
  op item edit "$TOKEN_ITEM" --vault "$TOKEN_VAULT" \
    "credential[password]=$token" \
    "expires_at[text]=${EXPIRES_IN} from ${timestamp}" \
    "account_name[text]=${account_name}" > /dev/null
  echo "✅ Updated '$TOKEN_ITEM' in the $TOKEN_VAULT vault"
else
  op item create --category "API Credential" \
    --title "$TOKEN_ITEM" --vault "$TOKEN_VAULT" \
    "credential[password]=$token" \
    "expires_at[text]=${EXPIRES_IN} from ${timestamp}" \
    "account_name[text]=${account_name}" > /dev/null
  echo "✅ Created '$TOKEN_ITEM' in the $TOKEN_VAULT vault"
fi

if command -v gh &> /dev/null; then
  printf '%s' "$token" | gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo "$REPO"
  echo "✅ Updated the OP_SERVICE_ACCOUNT_TOKEN secret on $REPO"
else
  echo "⚠️  gh CLI not found — set the GitHub secret manually:"
  echo "     gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo $REPO"
  echo "   (read the value from '$TOKEN_ITEM' in 1Password)"
fi

unset token

cat <<EOF

Done. To load it into your shell for local agent runs:

  export OP_SERVICE_ACCOUNT_TOKEN="\$(op read "op://${TOKEN_VAULT}/${TOKEN_ITEM}/credential")"

Older service accounts are NOT deleted automatically — review and remove them at
https://my.1password.com (Developer -> Service Accounts) once CI is green on the
new token.
EOF
