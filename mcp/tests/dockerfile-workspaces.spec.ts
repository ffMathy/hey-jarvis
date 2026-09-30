import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The server's image installs with `bun install --frozen-lockfile`, and bun refuses to install at
 * all when the root manifest names a workspace whose `package.json` is not there ("Workspace not
 * found"). The Dockerfile therefore copies every workspace's manifest before installing, and that
 * list is written out by hand — so it drifts whenever a workspace is added. It has twice: `mobile`,
 * `watch` and `hologram`, then `horizon`, and each time the image stopped building while Turbo went
 * on replaying `mcp#build` from its cache. This holds the list to the root manifest instead.
 */

const REPOSITORY_ROOT = join(import.meta.dir, '..', '..');

function readWorkspaces(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('workspaces' in manifest)) {
    throw new Error('The root package.json has no workspaces');
  }
  const { workspaces } = manifest;
  if (!Array.isArray(workspaces) || !workspaces.every((workspace) => typeof workspace === 'string')) {
    throw new Error('The root package.json lists its workspaces in a shape this check does not read');
  }
  return workspaces;
}

describe("the server image's workspace manifests", () => {
  const dockerfile = readFileSync(join(REPOSITORY_ROOT, 'mcp', 'Dockerfile'), 'utf8');

  it.each(readWorkspaces())('copies %s/package.json before installing', (workspace) => {
    const copyLine = `COPY ${workspace}/package.json ./${workspace}/`;
    const copiedAt = dockerfile.indexOf(copyLine);
    const installedAt = dockerfile.indexOf('RUN bun install --frozen-lockfile');

    expect(copiedAt).toBeGreaterThanOrEqual(0);
    expect(copiedAt).toBeLessThan(installedAt);
  });
});
