#!/usr/bin/env node
/**
 * PreToolUse hook: block reads of 1Password-resolved secret files.
 *
 * Replaces the previous bash+jq implementation, which silently failed open on
 * machines without `jq` (the script errored, produced an empty path, and exited 0
 * — allowing the read it was meant to deny).
 */

const path = require('node:path');

const BLOCKED_BASENAMES = new Set(['op.env.local', '.env', '.env.local', '.env.production']);

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const raw = readStdin();
if (!raw.trim()) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== 'string' || !filePath) process.exit(0);

const basename = path.basename(filePath.replace(/\\/g, '/'));

if (BLOCKED_BASENAMES.has(basename)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Reading ${basename} is not allowed — it contains sensitive secrets managed by 1Password. You may edit it blind (Write/Edit), but never read it.`,
      },
    }),
  );
}

process.exit(0);
