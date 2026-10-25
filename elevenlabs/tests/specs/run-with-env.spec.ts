import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dir, '../../..');
const runWithEnv = path.join(repositoryRoot, '.scripts/run-with-env.sh');

// Stands in for the 1Password CLI. Like the real `op run`, it refuses an env file holding a line it
// cannot parse as dotenv, and otherwise resolves every reference and runs the command after `--`.
const fakeOp = `#!/bin/bash
if [ "$1" = read ]; then exit 0; fi
env_file=""
for argument in "$@"; do
  case "$argument" in --env-file=*) env_file="\${argument#--env-file=}" ;; esac
done
line_number=0
while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))
  if [[ -z "$line" || "$line" =~ ^# ]]; then continue; fi
  if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*=(\\"[^\\"]*\\"|[^\\"\\'[:space:]]*)$ ]]; then
    echo "parsing Dotenv file: error at line $line_number" >&2
    exit 1
  fi
  export "\${line%%=*}=resolved"
done < "$env_file"
while [ "$1" != -- ]; do shift; done
shift
exec "$@"
`;

describe('run-with-env.sh', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'run-with-env-'));
    writeFileSync(path.join(directory, 'op'), fakeOp);
    chmodSync(path.join(directory, 'op'), 0o755);
    writeFileSync(path.join(directory, 'op.env'), 'FAKE_SECRET="op://vault/item/field"\n');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('resolves through 1Password while the environment holds a value that is not valid dotenv', () => {
    const result = Bun.spawnSync(
      ['bash', runWithEnv, path.join(directory, 'op.env'), 'bash', '-c', 'printf "%s|%s" "$FAKE_SECRET" "$UNQUOTED"'],
      {
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          OP_SERVICE_ACCOUNT_TOKEN: 'fake',
          UNQUOTED: 'say "hi" HEY there',
        },
      },
    );

    expect(result.stderr.toString()).not.toContain('parsing Dotenv file');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toEndWith('resolved|say "hi" HEY there');
  });

  it('keeps an optional reference on its own line when the env file does not end in a newline', () => {
    writeFileSync(path.join(directory, 'op.env'), 'FAKE_SECRET="op://vault/item/field"');
    writeFileSync(path.join(directory, 'op.optional.env'), 'FAKE_OPTIONAL="op://vault/item/optional"\n');

    const result = Bun.spawnSync(
      [
        'bash',
        runWithEnv,
        path.join(directory, 'op.env'),
        'bash',
        '-c',
        'printf "%s|%s" "$FAKE_SECRET" "$FAKE_OPTIONAL"',
      ],
      {
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          OP_SERVICE_ACCOUNT_TOKEN: 'fake',
        },
      },
    );

    expect(result.stderr.toString()).not.toContain('parsing Dotenv file');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toEndWith('resolved|resolved');
  });
});
