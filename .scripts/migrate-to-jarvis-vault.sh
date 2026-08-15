#!/usr/bin/env bash
# ONE-TIME migration of Hey Jarvis credentials from the Personal vault into the
# dedicated `Jarvis` vault, so a read-only service account can reach them without
# being able to read anything else you own.
#
# Two policies, by credential type:
#
#   MOVE  - machine credentials (API keys, tokens, IDs) on single-purpose items.
#           The item leaves Personal. Values never pass through this shell;
#           1Password performs the move server-side.
#
#   COPY  - anything holding a real username/password login. Only the fields the
#           repo actually references are copied into the Jarvis vault, and the
#           original item stays in Personal, untouched and undeleted.
#
# Copied fields are duplicated, so if you later change one of those logins you
# must update both copies. That is the deliberate cost of keeping the originals.
#
# Delete this script once the migration has succeeded.
#
# Run from the repo root, on the branch where op.env already points at op://Jarvis/:
#   bash .scripts/migrate-to-jarvis-vault.sh
set -uo pipefail

SRC="Personal"
DST="Jarvis"
ENV_FILES=(mcp/op.env elevenlabs/op.env home-assistant-voice-firmware/op.env)

# Single-purpose service items: no human login on them, safe to relocate.
# NOTE: "Jarvis" here is an ITEM name that happens to match the vault name; the
# --current-vault/--destination-vault flags keep that unambiguous.
MOVE_ITEMS=(ElevenLabs Openweathermap Valdemarsro Jarvis Tavily Twilio)

# Items holding a username/password you want to keep in Personal:
#   Google, Microsoft - your personal accounts, with Jarvis fields added on
#   Bilkatogo         - your store login (username/password)
#   WiFi              - your home network name/password
COPY_ITEMS=(Google Microsoft Bilkatogo WiFi)

# --- guards -----------------------------------------------------------------
[ -f "${ENV_FILES[0]}" ] || { echo "❌ Run this from the repo root."; exit 1; }

if [ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "❌ OP_SERVICE_ACCOUNT_TOKEN is set. A service account cannot read $SRC."
  echo "   unset OP_SERVICE_ACCOUNT_TOKEN && eval \$(op signin)"
  exit 1
fi

op account get > /dev/null 2>&1 || { echo "❌ Not signed in - run: eval \$(op signin)"; exit 1; }
grep -q "op://$DST/" "${ENV_FILES[0]}" || { echo "❌ op.env does not reference op://$DST/ — wrong branch?"; exit 1; }

all_refs() { grep -ho "op://$DST/[^\"]*" "${ENV_FILES[@]}" | sort -u; }

# Field paths ("password", "Algolia/API key") the repo references for one item.
paths_for_item() {
  local item="$1" ref rest
  while IFS= read -r ref; do
    rest="${ref#op://$DST/}"
    [ "${rest%%/*}" = "$item" ] && printf '%s\n' "${rest#*/}"
  done < <(all_refs)
}

# --- plan -------------------------------------------------------------------
echo "MOVE (leaves $SRC):"
printf '  - %s\n' "${MOVE_ITEMS[@]}"
echo
echo "COPY (original stays in $SRC, only these fields are duplicated):"
for item in "${COPY_ITEMS[@]}"; do
  while IFS= read -r p; do
    [ -n "$p" ] && echo "  - $item / $p"
  done < <(paths_for_item "$item")
done

printf '\nType MIGRATE to continue: '
read -r reply < /dev/tty
[ "$reply" = "MIGRATE" ] || { echo "Aborted."; exit 1; }

# --- destination vault ------------------------------------------------------
if op vault get "$DST" > /dev/null 2>&1; then
  echo "✅ Vault '$DST' already exists."
else
  op vault create "$DST" > /dev/null && echo "✅ Created vault '$DST'."
fi

# --- move single-purpose service items --------------------------------------
for item in "${MOVE_ITEMS[@]}"; do
  if op item get "$item" --vault "$DST" > /dev/null 2>&1; then
    echo "⏭️  '$item' is already in $DST"
  elif op item move "$item" --current-vault "$SRC" --destination-vault "$DST" > /dev/null 2>&1; then
    echo "✅ Moved '$item'"
  else
    echo "⚠️  Could not move '$item' (missing or renamed in $SRC?) — handle it manually"
  fi
done

# --- copy referenced fields, leaving originals in place ---------------------
for item in "${COPY_ITEMS[@]}"; do
  args=()
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if ! value="$(op read "op://$SRC/$item/$path" 2> /dev/null)"; then
      echo "⚠️  '$item / $path' not found in $SRC — skipping"
      continue
    fi
    if [[ "$path" == */* ]]; then
      # op:// path carries a section: Item/Section/Field
      args+=("${path%%/*}.${path#*/}[password]=${value}")
    else
      args+=("${path}[password]=${value}")
    fi
  done < <(paths_for_item "$item")

  if [ ${#args[@]} -eq 0 ]; then
    echo "⚠️  Nothing to copy for '$item'"
    continue
  fi

  if op item get "$item" --vault "$DST" > /dev/null 2>&1; then
    op item edit "$item" --vault "$DST" "${args[@]}" > /dev/null \
      && echo "✅ Updated '$item' in $DST (${#args[@]} fields; original left in $SRC)"
  else
    op item create --category "Secure Note" --title "$item" --vault "$DST" "${args[@]}" > /dev/null \
      && echo "✅ Created '$item' in $DST (${#args[@]} fields; original left in $SRC)"
  fi
  unset args value
done

# --- verify every reference the repo actually uses --------------------------
echo
echo "Verifying every op:// reference in the repo resolves from '$DST'..."
ok=0
bad=0
while IFS= read -r ref; do
  if op read "$ref" > /dev/null 2>&1; then
    ok=$((ok + 1))
  else
    bad=$((bad + 1))
    echo "  ❌ $ref"
  fi
done < <(all_refs)

echo
echo "Resolved: $ok   Failed: $bad"
if [ "$bad" -eq 0 ]; then
  echo "🎉 Migration complete. Next: bash .scripts/rotate-service-account.sh"
else
  echo "⚠️  Fix the failures above before issuing a service account token."
  echo "   Moved originals are recoverable from Recently Deleted in 1Password."
  exit 1
fi
