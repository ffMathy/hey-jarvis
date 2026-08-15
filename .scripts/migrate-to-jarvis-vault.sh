#!/usr/bin/env bash
# ONE-TIME migration of Hey Jarvis credentials from the Personal vault into the
# dedicated `Jarvis` vault, so a read-only service account can reach them without
# being able to read anything else you own.
#
# Two policies, by credential type:
#
#   MOVE  - machine credentials (API keys, tokens, IDs) on single-purpose items.
#           The item leaves $SRC. Values never pass through this shell;
#           1Password performs the move server-side.
#
#   COPY  - anything holding a real username/password login, and anything living
#           in a vault the service account cannot read. Only the fields the repo
#           actually references are copied into the Jarvis vault; the original
#           item stays where it is, untouched and undeleted.
#
# Copied fields are duplicated, so if you later change one of those logins you
# must update both copies. That is the deliberate cost of keeping the originals.
#
# Most items are read from $SRC. Bilkatogo is shared into the "Shared" vault
# instead, so it has a per-item source (see ITEM_SRC below); the service account
# is never granted access to Shared.
#
# Delete this script once the migration has succeeded.
#
# Run from the repo root, on the branch where op.env already points at op://Jarvis/:
#   bash .scripts/migrate-to-jarvis-vault.sh
#
# Rehearse it first — this previews every write and moves/creates nothing:
#   DRY_RUN=1 bash .scripts/migrate-to-jarvis-vault.sh
#
# On a Families account the personal vault is called "Private", not "Personal":
#   SRC=Private DRY_RUN=1 bash .scripts/migrate-to-jarvis-vault.sh
set -uo pipefail

# The name of your personal vault depends on the account type: "Personal" on an
# Individual account, "Private" on a Families account, "Employee" on Business.
# Check with `op vault list` and override if needed:
#   SRC=Private bash .scripts/migrate-to-jarvis-vault.sh
SRC="${SRC:-Personal}"
DST="${DST:-Jarvis}"
ENV_FILES=(mcp/op.env elevenlabs/op.env home-assistant-voice-firmware/op.env)

# Single-purpose service items: no human login on them, safe to relocate.
# NOTE: "Jarvis" here is an ITEM name that happens to match the vault name; the
# --current-vault/--destination-vault flags keep that unambiguous.
MOVE_ITEMS=(ElevenLabs Openweathermap Valdemarsro Jarvis Tavily Twilio)

# Items holding a username/password you want to keep where they are:
#   Google, Microsoft - your personal accounts, with Jarvis fields added on
#   Bilkatogo         - your store login (username/password)
#   WiFi              - your home network name/password
COPY_ITEMS=(Google Microsoft Bilkatogo WiFi)

# Items that do not live in $SRC. Bilkatogo is shared into the "Shared" vault,
# which the service account has no access to — copying its referenced fields into
# $DST is exactly what makes them reachable, and the shared original is untouched.
SHARED="${SHARED:-Shared}"
declare -A ITEM_SRC=(
  [Bilkatogo]="$SHARED"
)

# The vault a given item is read from, defaulting to $SRC.
src_for_item() { printf '%s' "${ITEM_SRC[$1]:-$SRC}"; }

# --- guards -----------------------------------------------------------------
dry_run_flags=()
mark="✅"
verb_create="Created"
verb_update="Updated"
if [ -n "${DRY_RUN:-}" ]; then
  dry_run_flags=(--dry-run)
  mark="🔍"
  verb_create="Would create"
  verb_update="Would update"
fi

[ -f "${ENV_FILES[0]}" ] || { echo "❌ Run this from the repo root."; exit 1; }

command -v jq > /dev/null 2>&1 || {
  echo "❌ jq is required (secret values are passed to 1Password as JSON on stdin)."
  echo "   sudo apt-get install -y jq"
  exit 1
}

if [ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "❌ OP_SERVICE_ACCOUNT_TOKEN is set. A service account cannot read $SRC."
  echo "   unset OP_SERVICE_ACCOUNT_TOKEN && eval \$(op signin)"
  exit 1
fi

op account get > /dev/null 2>&1 || { echo "❌ Not signed in - run: eval \$(op signin)"; exit 1; }

# Fail fast on a wrong source vault rather than reporting 32 confusing lookup failures.
for vault in "$SRC" "${ITEM_SRC[@]}"; do
  op vault get "$vault" > /dev/null 2>&1 || {
    echo "❌ Source vault '$vault' not found on this account."
    echo "   The personal vault is 'Personal' on Individual accounts, 'Private' on"
    echo "   Families, and 'Employee' on Business. Vaults available here:"
    op vault list 2> /dev/null | sed 's/^/     /'
    echo "   Re-run with:  SRC=<name> SHARED=<name> bash .scripts/migrate-to-jarvis-vault.sh"
    exit 1
  }
done
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
echo "COPY (original stays put, only these fields are duplicated):"
for item in "${COPY_ITEMS[@]}"; do
  while IFS= read -r p; do
    [ -n "$p" ] && echo "  - $(src_for_item "$item") / $item / $p"
  done < <(paths_for_item "$item")
done

if [ -n "${DRY_RUN:-}" ]; then
  echo
  echo "🔍 DRY_RUN — previewing every write. Nothing will be moved, created or changed."
else
  printf '\nType MIGRATE to continue: '
  read -r reply < /dev/tty
  [ "$reply" = "MIGRATE" ] || { echo "Aborted."; exit 1; }
fi

# --- destination vault ------------------------------------------------------
# Neither `op vault create` nor `op item move` has a --dry-run, so a rehearsal
# reports what it would do and changes nothing.
if op vault get "$DST" > /dev/null 2>&1; then
  echo "✅ Vault '$DST' already exists."
elif [ -n "${DRY_RUN:-}" ]; then
  echo "🔍 Would create vault '$DST'."
  echo "   It does not exist yet, so the per-item previews below cannot run."
  echo "   Create it first if you want a full rehearsal:  op vault create $DST"
  exit 0
else
  op vault create "$DST" > /dev/null && echo "✅ Created vault '$DST'."
fi

# --- move single-purpose service items --------------------------------------
for item in "${MOVE_ITEMS[@]}"; do
  if op item get "$item" --vault "$DST" > /dev/null 2>&1; then
    echo "⏭️  '$item' is already in $DST"
  elif [ -n "${DRY_RUN:-}" ]; then
    if op item get "$item" --vault "$SRC" > /dev/null 2>&1; then
      echo "🔍 Would move '$item' from $SRC to $DST"
    else
      echo "⚠️  '$item' not found in $SRC — would need handling manually"
    fi
  elif op item move "$item" --current-vault "$SRC" --destination-vault "$DST" > /dev/null 2>&1; then
    echo "✅ Moved '$item'"
  else
    echo "⚠️  Could not move '$item' (missing or renamed in $SRC?) — handle it manually"
  fi
done

# --- copy referenced fields, leaving originals in place ---------------------
#
# Secret values reach 1Password as JSON on stdin, never as command arguments.
# Command arguments land in /proc/<pid>/cmdline, which is world-readable, so an
# assignment statement like `password[password]=$value` exposes the value to every
# process on the machine while the command runs. 1Password's own docs say to use a
# JSON template for sensitive values. `jq -Rs` slurps stdin verbatim, so passwords
# containing quotes, backslashes or newlines survive intact.
emit_fields() {
  local item="$1" item_src path section label value
  item_src="$(src_for_item "$item")"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if ! value="$(op read "op://$item_src/$item/$path" 2> /dev/null)"; then
      echo "⚠️  '$item / $path' not found in $item_src — skipping" >&2
      continue
    fi
    if [[ "$path" == */* ]]; then
      # op:// path carries a section: Item/Section/Field
      section="${path%%/*}"
      label="${path#*/}"
    else
      section=""
      label="$path"
    fi
    # NB: `label` is a reserved word in jq, so the variable is $fieldLabel.
    printf '%s' "$value" | jq -Rs -c --arg section "$section" --arg fieldLabel "$label" \
      '{ type: "CONCEALED", label: $fieldLabel, value: . }
       + (if $section == "" then {} else { section: { id: $section, label: $section } } end)'
    unset value
  done < <(paths_for_item "$item")
}

for item in "${COPY_ITEMS[@]}"; do
  fields="$(emit_fields "$item" | jq -s -c '.')"
  count="$(printf '%s' "$fields" | jq 'length')"

  if [ "$count" -eq 0 ]; then
    echo "⚠️  Nothing to copy for '$item'"
    continue
  fi

  payload="$(printf '%s' "$fields" | jq -c --arg title "$item" \
    '{ title: $title,
       category: "SECURE_NOTE",
       sections: ([ .[].section // empty ] | unique),
       fields: . }')"

  if op item get "$item" --vault "$DST" > /dev/null 2>&1; then
    printf '%s' "$payload" | op item edit "$item" --vault "$DST" "${dry_run_flags[@]}" > /dev/null \
      && echo "$mark ${verb_update} '$item' in $DST ($count fields; original left in $(src_for_item "$item"))"
  else
    printf '%s' "$payload" | op item create --vault "$DST" "${dry_run_flags[@]}" - > /dev/null \
      && echo "$mark ${verb_create} '$item' in $DST ($count fields; original left in $(src_for_item "$item"))"
  fi
  unset fields payload count
done

# --- verify every reference the repo actually uses --------------------------
if [ -n "${DRY_RUN:-}" ]; then
  echo
  echo "🔍 Rehearsal complete. Nothing was changed, so the reference check is skipped."
  echo "   Run it for real with:  bash .scripts/migrate-to-jarvis-vault.sh"
  exit 0
fi

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
