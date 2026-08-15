#!/usr/bin/env node
/**
 * PreToolUse hook: require every shell command to run under a timeout.
 *
 * Bash (Git Bash / POSIX sh) -> GNU coreutils `timeout <duration> <cmd>`.
 * PowerShell -> a recognized timeout construct (see POWERSHELL_PATTERNS), because
 * Windows' own `timeout.exe` is a *sleep*, not a watchdog, and would silently
 * swallow the real command.
 */

const BASH_TIMEOUT = /^timeout\s+(?:-{1,2}[^\s]+(?:\s+[^\s-][^\s]*)?\s+)*\d+(?:\.\d+)?[smhd]?\s+\S/;

// Builtins that cannot hang and that `timeout` would break (it forks a subprocess,
// so `timeout 5 cd foo` changes the directory of a process that immediately exits).
const EXEMPT_BUILTINS = new Set([
  'cd',
  'export',
  'set',
  'unset',
  'source',
  '.',
  ':',
  'true',
  'false',
  'exit',
  'alias',
  'unalias',
  'shift',
  'local',
  'return',
  'eval',
  // Structural keywords that introduce no command of their own. `do`/`then`/`else`
  // appear here for the standalone (own-line) case; as prefixes they are stripped.
  'fi',
  'done',
  'esac',
  'break',
  'continue',
  'do',
  'then',
  'else',
  // `for x in LIST` / `case x in` are headers, not commands.
  'for',
  'case',
  'select',
  'in',
]);

// Keywords that *precede* a real command (`do cat f`, `if grep x f`). They are
// stripped so the command behind them is what gets checked.
const PREFIX_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', 'function', 'time']);

const POWERSHELL_PATTERNS = [
  /Wait-Job\b[^|;]*-Timeout\s+\d+/i,
  /Wait-Process\b[^|;]*-Timeout\s+\d+/i,
  /\btimeout\.exe\b/i,
  /usr[\\/]bin[\\/]timeout/i,
];

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Consume a quoted run starting at `start`, returning its text and the next index. */
function readQuoted(command, start) {
  const quote = command[start];
  let text = quote;
  let i = start + 1;

  while (i < command.length) {
    const char = command[i];
    text += char;
    if (char === '\\' && quote === '"' && i + 1 < command.length) {
      text += command[i + 1];
      i += 2;
      continue;
    }
    if (char === quote) return { text, next: i + 1 };
    i++;
  }

  return { text, next: i };
}

/** Length of a top-level command separator at `i`, or 0 if there isn't one. */
function separatorLength(command, i, depth) {
  if (depth > 0) return 0;
  const char = command[i];
  if (char === ';' || char === '\n') return 1;
  if ((char === '&' || char === '|') && command[i + 1] === char) return 2;
  return 0;
}

function isCommentStart(command, i) {
  return command[i] === '#' && (i === 0 || /\s/.test(command[i - 1]));
}

/**
 * Classify the construct at `i`, returning the text it contributes to the current
 * segment, the next index to scan, the resulting `$(` nesting depth, and whether it
 * ends the segment (`isSeparator`) or the whole scan (`stop`).
 */
function scanToken(command, i, depth) {
  const char = command[i];

  if (char === "'" || char === '"' || char === '`') {
    const { text, next } = readQuoted(command, i);
    return { text, next, depth };
  }

  // A heredoc body is opaque to this splitter — take it verbatim and stop.
  if (char === '<' && command[i + 1] === '<') {
    return { text: command.slice(i), next: command.length, depth, stop: true };
  }

  // Drop the comment; the newline it stops at is handled as a separator next pass.
  if (isCommentStart(command, i)) {
    const newline = command.indexOf('\n', i);
    if (newline === -1) return { text: '', next: command.length, depth, stop: true };
    return { text: '', next: newline, depth };
  }

  if (char === '$' && command[i + 1] === '(') {
    return { text: '$(', next: i + 2, depth: depth + 1 };
  }

  if (char === ')' && depth > 0) {
    return { text: char, next: i + 1, depth: depth - 1 };
  }

  const separator = separatorLength(command, i, depth);
  if (separator > 0) return { text: '', next: i + separator, depth, isSeparator: true };

  return { text: char, next: i + 1, depth };
}

/**
 * Split a shell command on top-level `;`, `&&` and `||`, ignoring separators that
 * sit inside quotes, `$(...)`/backticks, comments, or a heredoc body.
 */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let depth = 0;
  let i = 0;

  while (i < command.length) {
    const token = scanToken(command, i, depth);

    if (token.isSeparator) {
      segments.push(current);
      current = '';
    } else {
      current += token.text;
    }

    depth = token.depth;
    i = token.next;
    if (token.stop) break;
  }

  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function stripPrefixes(segment) {
  // Drop subshell/group openers, `!` negation, control-flow keywords and env-var
  // assignments so the real command word is what gets checked.
  let rest = segment.trim();
  let changed = true;

  while (changed) {
    changed = false;
    const opener = rest.replace(/^(?:[({]|!)\s*/, '');
    if (opener !== rest) {
      rest = opener;
      changed = true;
    }
    const assignment = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '');
    if (assignment !== rest) {
      rest = assignment;
      changed = true;
    }
    const word = rest.split(/\s+/)[0];
    if (PREFIX_KEYWORDS.has(word) && rest.length > word.length) {
      rest = rest.slice(word.length).trim();
      changed = true;
    }
  }

  return rest.trim();
}

function checkBash(command) {
  for (const segment of splitSegments(command)) {
    const stripped = stripPrefixes(segment);
    if (!stripped) continue;

    const word = stripped.split(/\s+/)[0].replace(/^\\/, '');
    if (EXEMPT_BUILTINS.has(word)) continue;
    if (BASH_TIMEOUT.test(stripped)) continue;

    return `Every command must run under GNU \`timeout\`. This segment does not: \`${segment.slice(0, 120)}\`

Prefix it with a duration, e.g.:
  timeout 60 bunx turbo test --filter=some-project
  timeout 5m git push

Exempt (cannot hang, and \`timeout\` would fork them uselessly): ${[...EXEMPT_BUILTINS].join(', ')}.`;
  }
  return null;
}

function checkPowerShell(command) {
  if (POWERSHELL_PATTERNS.some((pattern) => pattern.test(command))) return null;

  return `Every command must run under a timeout. Windows' bare \`timeout\` is a *sleep*, not a watchdog, so it is not accepted here.

Prefer the Bash tool with GNU timeout:
  timeout 60 <command>

Or, if PowerShell is required, use one of:
  $j = Start-Job { <command> }; if (Wait-Job $j -Timeout 60) { Receive-Job $j } else { Stop-Job $j; throw 'timed out' }
  & 'C:\\Program Files\\Git\\usr\\bin\\timeout.exe' 60 <command>`;
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) process.exit(0);

  const toolName = payload?.tool_name;
  const reason = toolName === 'PowerShell' ? checkPowerShell(command) : checkBash(command);
  if (reason) deny(reason);

  process.exit(0);
}

main();
