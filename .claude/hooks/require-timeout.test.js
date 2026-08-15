#!/usr/bin/env node
/**
 * Test matrix for the require-timeout PreToolUse hook.
 * Run: node .claude/hooks/require-timeout.test.js
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, 'require-timeout.js');

const CASES = [
  // Bash — missing timeout
  ['Bash', 'ls -la', 'DENY'],
  ['Bash', 'bunx turbo test', 'DENY'],
  ['Bash', 'timeout 30 npm i && npm test', 'DENY'],
  ['Bash', 'for f in *; do cat $f; done', 'DENY'],
  ['Bash', 'if grep -q x file; then timeout 5 echo hi; fi', 'DENY'],
  ['Bash', 'FOO=bar npm test', 'DENY'],
  ['Bash', '(npm test)', 'DENY'],

  // Bash — properly wrapped
  ['Bash', 'timeout 60 ls -la', 'ALLOW'],
  ['Bash', 'timeout 5m bunx turbo test', 'ALLOW'],
  ['Bash', 'timeout 1.5s ./flaky', 'ALLOW'],
  ['Bash', 'timeout --signal=KILL 30 npm i', 'ALLOW'],
  ['Bash', 'timeout -k 5 30 npm i', 'ALLOW'],
  ['Bash', 'cd /tmp && timeout 30 npm i', 'ALLOW'],
  ['Bash', 'timeout 30 npm i && timeout 60 npm test', 'ALLOW'],
  ['Bash', 'FOO=bar timeout 10 env', 'ALLOW'],
  ['Bash', 'for f in *; do timeout 5 cat $f; done', 'ALLOW'],
  ['Bash', 'if timeout 5 grep -q x file; then timeout 5 echo hi; fi', 'ALLOW'],
  ['Bash', 'timeout 60 echo "a;b"', 'ALLOW'],
  ['Bash', 'timeout 10 git commit -m "x; y && z"', 'ALLOW'],
  ['Bash', 'timeout 60 cat <<EOF\na; b && c\nEOF', 'ALLOW'],
  ['Bash', 'timeout 30 ls | head -5', 'ALLOW'],
  ['Bash', 'cd /tmp', 'ALLOW'],
  ['Bash', 'export FOO=bar', 'ALLOW'],

  // PowerShell
  ['PowerShell', 'Get-ChildItem', 'DENY'],
  ['PowerShell', 'timeout 60 npm test', 'DENY'], // Windows timeout.exe is a sleep
  ['PowerShell', '$j = Start-Job { npm test }; Wait-Job $j -Timeout 60', 'ALLOW'],
  ['PowerShell', "& 'C:\\Program Files\\Git\\usr\\bin\\timeout.exe' 60 npm test", 'ALLOW'],

  // Non-shell tools and empty payloads pass through untouched
  ['Read', undefined, 'ALLOW'],
  ['Bash', '   ', 'ALLOW'],
];

let failures = 0;

for (const [tool, command, expected] of CASES) {
  const payload = { tool_name: tool, tool_input: command === undefined ? {} : { command } };
  const output = execFileSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  const actual = output.includes('"deny"') ? 'DENY' : 'ALLOW';
  const ok = actual === expected;
  if (!ok) failures++;
  const label = (command ?? '<none>').replace(/\n/g, '\\n');
  console.log(`${ok ? 'PASS' : 'FAIL'}  want=${expected.padEnd(5)} got=${actual.padEnd(5)} [${tool}] ${label}`);
}

console.log(failures ? `\n${failures} of ${CASES.length} cases FAILED` : `\nAll ${CASES.length} cases pass`);
process.exit(failures ? 1 : 0);
