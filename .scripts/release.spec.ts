import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextVersion, parseCommit } from './release.js';

const script = path.join(import.meta.dir, 'release.js');

describe('parseCommit', () => {
  it('reads the type, scope and subject of a conventional header', () => {
    expect(parseCommit('abc', 'fix(mcp): store logs (#994)\n\nbody')).toEqual({
      sha: 'abc',
      type: 'fix',
      scope: 'mcp',
      subject: 'store logs (#994)',
      breaking: false,
    });
  });

  it('marks a commit breaking by its bang or its footer', () => {
    expect(parseCommit('abc', 'feat!: drop it').breaking).toBe(true);
    expect(parseCommit('abc', 'feat: drop it\n\nBREAKING CHANGE: gone').breaking).toBe(true);
  });

  it('keeps a commit that is not conventional, with no type', () => {
    expect(parseCommit('abc', 'Update README.md')).toMatchObject({ type: null, subject: 'Update README.md' });
  });

  it('parses only the subject, so a body line shaped like a header cannot break it', () => {
    expect(parseCommit('abc', 'fix(vr): x\n\nfs.rmSync(path.join(dir, "ios"));')).toMatchObject({
      type: 'fix',
      scope: 'vr',
    });
  });
});

describe('nextVersion', () => {
  const commit = (type: string | null, breaking = false) => ({ sha: 'abc', type, scope: null, subject: 's', breaking });

  it('raises the patch for anything that is not a feature', () => {
    expect(nextVersion('4.28.3', [commit('chore'), commit('ci'), commit(null)])).toBe('4.28.4');
  });

  it('raises the minor for a feature', () => {
    expect(nextVersion('4.28.3', [commit('fix'), commit('feat')])).toBe('4.29.0');
  });

  it('raises the major for a breaking change', () => {
    expect(nextVersion('4.28.3', [commit('feat'), commit('fix', true)])).toBe('5.0.0');
  });
});

describe('the release a push to main cuts', () => {
  let repository: string;
  let output: string;

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  const commit = (message: string) => git('commit', '--allow-empty', '-q', '-m', message);
  const release = () => {
    writeFileSync(output, '');
    execFileSync('node', [script, 'HEAD', output], { cwd: repository });
    return Object.fromEntries(
      readFileSync(output, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
  };

  beforeEach(() => {
    repository = mkdtempSync(path.join(os.tmpdir(), 'release-spec-'));
    output = path.join(repository, '..', `${path.basename(repository)}.output`);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'spec@example.com');
    git('config', 'user.name', 'spec');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    commit('chore: start');
    git('tag', 'root-v4.28.3');
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
    rmSync(output, { force: true });
  });

  it('releases a chore-only merge as a patch', () => {
    commit('chore(deps): bump something (#1)');

    expect(release()).toMatchObject({ version: '4.28.4', tag: 'root-v4.28.4' });
  });

  it('writes notes grouped by type, linking each commit and the comparison', () => {
    commit('fix(mcp): store logs (#2)');
    commit('feat(vr): stand in the room (#3)');
    commit('Update README.md');
    const sha = git('rev-parse', 'HEAD~1');

    const { version, notes } = release();
    const text = readFileSync(notes, 'utf8');

    expect(version).toBe('4.29.0');
    expect(text).toContain('## [4.29.0](https://github.com/ffMathy/hey-jarvis/compare/root-v4.28.3...root-v4.29.0)');
    expect(text).toContain(
      `### Features\n\n* **vr:** stand in the room (#3) ([${sha.slice(0, 7)}](https://github.com/ffMathy/hey-jarvis/commit/${sha}))`,
    );
    expect(text).toContain('### Bug Fixes\n\n* **mcp:** store logs (#2)');
    expect(text).toContain('### Other changes\n\n* Update README.md');
    expect(text.indexOf('### Features')).toBeLessThan(text.indexOf('### Bug Fixes'));
  });

  it('counts only what landed since the last release tag', () => {
    commit('feat: one');
    git('tag', 'root-v4.29.0');
    commit('fix: two');

    const { version, notes } = release();

    expect(version).toBe('4.29.1');
    expect(readFileSync(notes, 'utf8')).not.toContain('one');
  });

  it('cuts nothing when the commit is already released', () => {
    expect(release()).toEqual({});
  });
});
