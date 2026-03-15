#!/usr/bin/env bash
# Dynamically populates turbo.json's globalPassThroughEnv from all op.env files.
# Run on devcontainer init to keep the list in sync with op.env additions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

python3 - "$REPO_ROOT" <<'PYTHON'
import json
import sys
import glob
import os

repo_root = sys.argv[1]
turbo_json_path = os.path.join(repo_root, 'turbo.json')

with open(turbo_json_path, 'r') as f:
    turbo = json.load(f)

# Preserve existing non-HEY_JARVIS_ vars (CI/system vars) in their original order
existing = turbo.get('globalPassThroughEnv', [])
seed_vars = [v for v in existing if not v.startswith('HEY_JARVIS_')]

# Collect all HEY_JARVIS_* var names from every op.env file in the repo
env_vars: set[str] = set()
for env_file in glob.glob(os.path.join(repo_root, '**', 'op.env'), recursive=True):
    if 'node_modules' in env_file:
        continue
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            var_name = line.split('=')[0].strip().strip('"')
            if var_name:
                env_vars.add(var_name)

# Seed CI vars first (original order), then sorted HEY_JARVIS_* vars from op.env
all_vars = seed_vars + sorted(env_vars - set(seed_vars))
turbo['globalPassThroughEnv'] = all_vars

with open(turbo_json_path, 'w') as f:
    json.dump(turbo, f, indent=2)
    f.write('\n')

print(f"✅ Updated turbo.json: {len(all_vars)} vars in globalPassThroughEnv ({len(env_vars)} from op.env files)")
PYTHON
