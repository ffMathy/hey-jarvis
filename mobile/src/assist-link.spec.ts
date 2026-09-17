import { describe, expect, it } from 'bun:test';
import { ASSIST_URL, createAssistLaunchClaim, isAssistLaunch } from './assist-link';

describe('isAssistLaunch', () => {
  it('recognises the URL the voice interaction session opens', () => {
    expect(isAssistLaunch(ASSIST_URL)).toBe(true);
  });

  it('accepts the single-slash spelling Android sometimes normalises to', () => {
    expect(isAssistLaunch('heyjarvis:/assist')).toBe(true);
    expect(isAssistLaunch('heyjarvis:assist')).toBe(true);
  });

  it('ignores a query string, so the session may say where it came from', () => {
    expect(isAssistLaunch('heyjarvis://assist?source=voice-interaction')).toBe(true);
  });

  it('ignores a trailing slash and casing', () => {
    expect(isAssistLaunch('heyjarvis://Assist/')).toBe(true);
  });

  it('treats a plain launch as not being an assist launch', () => {
    expect(isAssistLaunch(null)).toBe(false);
    expect(isAssistLaunch(undefined)).toBe(false);
    expect(isAssistLaunch('')).toBe(false);
    expect(isAssistLaunch('heyjarvis://')).toBe(false);
  });

  it('does not mistake another destination for the assistant', () => {
    expect(isAssistLaunch('heyjarvis://settings')).toBe(false);
    expect(isAssistLaunch('heyjarvis://assistant')).toBe(false);
    expect(isAssistLaunch('heyjarvis://assist/settings')).toBe(false);
  });
});

describe('createAssistLaunchClaim', () => {
  it('acts on a summoning once, however many times its URL is seen', () => {
    const claim = createAssistLaunchClaim();

    expect(claim('heyjarvis://assist?summon=100')).toBe(true);
    expect(claim('heyjarvis://assist?summon=100')).toBe(false);
    expect(claim('heyjarvis://assist?summon=100')).toBe(false);
  });

  it('acts on every new summoning in the same process', () => {
    // The failure this exists for: on a device, only the first summoning after
    // the app started opened the microphone, and every later one just brought
    // the app to the front.
    const claim = createAssistLaunchClaim();

    expect(claim('heyjarvis://assist?summon=100')).toBe(true);
    expect(claim('heyjarvis://assist?summon=200')).toBe(true);
    expect(claim('heyjarvis://assist?summon=300')).toBe(true);
  });

  it('does not act on an earlier summoning read back again later', () => {
    // A remounted screen reads the activity's original launch URL, not the
    // latest one.
    const claim = createAssistLaunchClaim();

    claim('heyjarvis://assist?summon=100');
    claim('heyjarvis://assist?summon=200');

    expect(claim('heyjarvis://assist?summon=100')).toBe(false);
  });

  it('never acts on a launch that is not a summoning', () => {
    const claim = createAssistLaunchClaim();

    expect(claim(null)).toBe(false);
    expect(claim(undefined)).toBe(false);
    expect(claim('heyjarvis://settings')).toBe(false);
  });
});
