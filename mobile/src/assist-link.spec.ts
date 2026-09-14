import { describe, expect, it } from 'bun:test';
import { ASSIST_URL, isAssistLaunch } from './assist-link';

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
