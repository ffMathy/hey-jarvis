import { describe, expect, it } from 'bun:test';
import { pairedTokenFromLink, phonePairingUrl } from './pairing-link';

const ADDRESS = 'https://jarvis.example.com';
const TOKEN = 'p'.repeat(43);

describe('the phone’s pairing page and link', () => {
  it('opens the server’s own pairing page', () => {
    expect(phonePairingUrl(ADDRESS)).toBe('https://jarvis.example.com/api/devices/pair');
  });

  it('reads the token out of the link the pairing page opens the app with', () => {
    expect(pairedTokenFromLink(`heyjarvis://paired#token=${TOKEN}`)).toBe(TOKEN);
    expect(pairedTokenFromLink(`heyjarvis://paired#other=1&token=${TOKEN}`)).toBe(TOKEN);
  });

  it('reads no token out of any other link, or one that is not a token', () => {
    expect(pairedTokenFromLink(undefined)).toBeUndefined();
    expect(pairedTokenFromLink(null)).toBeUndefined();
    expect(pairedTokenFromLink('heyjarvis://assist')).toBeUndefined();
    expect(pairedTokenFromLink(`heyjarvis://paired?token=${TOKEN}`)).toBeUndefined();
    expect(pairedTokenFromLink(`https://evil.example/paired#token=${TOKEN}`)).toBeUndefined();
    expect(pairedTokenFromLink('heyjarvis://paired#token=<script>')).toBeUndefined();
    expect(pairedTokenFromLink('heyjarvis://paired#token')).toBeUndefined();
  });
});
