import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { fingerprintSecret, isContinuousIntegration, shouldRevealToken } from './generate-refresh-tokens.js';

const CI_ENV_VARS = ['CI', 'GITHUB_ACTIONS'];
const REVEAL_ENV_VAR = 'HEY_JARVIS_REVEAL_REFRESH_TOKEN';

describe('refresh token disclosure', () => {
  const managedEnvVars = [...CI_ENV_VARS, REVEAL_ENV_VAR];
  const savedEnvironment = new Map<string, string | undefined>();
  let savedArgv: string[] = [];

  // The decision reads the real process environment, and the test process itself runs with CI set
  // on a build server, so each case starts from a cleared baseline and puts the values back after.
  beforeEach(() => {
    savedArgv = process.argv;
    process.argv = ['bun', 'generate-refresh-tokens.ts'];

    for (const name of managedEnvVars) {
      savedEnvironment.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    process.argv = savedArgv;

    for (const [name, value] of savedEnvironment) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    savedEnvironment.clear();
  });

  it('summarises a token by length and last three characters only', () => {
    const token = '1//0abcdefghijklmnopqrstuvwxyz';

    const fingerprint = fingerprintSecret(token);

    expect(fingerprint).toBe('30 characters, ending in "xyz"');
    expect(fingerprint).not.toContain(token);
  });

  it('does not mistake a plain terminal for CI', () => {
    expect(isContinuousIntegration()).toBe(false);
  });

  it('keeps a stored token hidden when nobody asked to see it', () => {
    expect(shouldRevealToken({ storedSuccessfully: true })).toBe(false);
  });

  it('reveals the token when the environment variable opt-in is set', () => {
    process.env[REVEAL_ENV_VAR] = '1';

    expect(shouldRevealToken({ storedSuccessfully: true })).toBe(true);
  });

  it('reveals the token when the command line flag is passed', () => {
    process.argv = [...process.argv, '--reveal-token'];

    expect(shouldRevealToken({ storedSuccessfully: true })).toBe(true);
  });

  it('reveals the token when storage failed, because the terminal is then the only copy', () => {
    expect(shouldRevealToken({ storedSuccessfully: false })).toBe(true);
  });

  it.each(CI_ENV_VARS)('never reveals the token when %s is set, however loudly it is requested', (ciEnvVar) => {
    process.env[ciEnvVar] = 'true';
    process.env[REVEAL_ENV_VAR] = '1';
    process.argv = [...process.argv, '--reveal-token'];

    expect(isContinuousIntegration()).toBe(true);
    expect(shouldRevealToken({ storedSuccessfully: true })).toBe(false);
    expect(shouldRevealToken({ storedSuccessfully: false })).toBe(false);
  });
});
