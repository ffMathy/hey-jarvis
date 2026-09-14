import { describe, expect, it } from 'bun:test';
import {
  describeAccessTokenProblem,
  describeServerUrlProblem,
  normalizeServerUrl,
  parseServerSettings,
} from './server-settings';

describe('normalizeServerUrl', () => {
  it('trims whitespace and the trailing slash so paths append cleanly', () => {
    expect(normalizeServerUrl('  https://jarvis.example.com/  ')).toBe('https://jarvis.example.com');
    expect(normalizeServerUrl('https://jarvis.example.com///')).toBe('https://jarvis.example.com');
  });

  it('leaves a path on the URL alone, because the server may be mounted under one', () => {
    expect(normalizeServerUrl('https://example.com/jarvis')).toBe('https://example.com/jarvis');
  });
});

describe('describeServerUrlProblem', () => {
  it('accepts an https URL', () => {
    expect(describeServerUrlProblem('https://jarvis.example.com')).toBeUndefined();
  });

  it('refuses plain http, which would put the access token on the wire in clear', () => {
    expect(describeServerUrlProblem('http://jarvis.example.com')).toContain('https');
  });

  it('refuses a URL with no scheme at all', () => {
    expect(describeServerUrlProblem('jarvis.example.com')).toContain('https://');
  });

  it('refuses an empty address', () => {
    expect(describeServerUrlProblem('   ')).toBeDefined();
  });

  it('refuses a scheme with nothing after it', () => {
    expect(describeServerUrlProblem('https://')).toContain('host name');
  });
});

describe('describeAccessTokenProblem', () => {
  it('accepts a token', () => {
    expect(describeAccessTokenProblem('a-secret')).toBeUndefined();
  });

  it('refuses a blank token', () => {
    expect(describeAccessTokenProblem('   ')).toBeDefined();
  });
});

describe('parseServerSettings', () => {
  it('returns normalized settings when both values are usable', () => {
    const result = parseServerSettings(' https://jarvis.example.com/ ', '  a-secret  ');

    expect(result).toEqual({
      settings: { serverUrl: 'https://jarvis.example.com', accessToken: 'a-secret' },
    });
  });

  it('reports the URL problem first, since a token cannot be checked without a server', () => {
    const result = parseServerSettings('http://jarvis.example.com', '');

    expect(result).toEqual({
      problem: 'The address has to use https — the access token is sent with every request.',
    });
  });

  it('reports a missing token once the URL is fine', () => {
    const result = parseServerSettings('https://jarvis.example.com', '');

    expect(result).toHaveProperty('problem');
  });
});
