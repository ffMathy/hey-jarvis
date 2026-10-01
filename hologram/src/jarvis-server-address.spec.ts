import { describe, expect, it } from 'bun:test';
import { parseJarvisServerAddress } from './jarvis-server-address';

const ADDRESS = 'https://jarvis.example.com';

describe('reading the address sir typed', () => {
  it('takes an https origin as it is', () => {
    expect(parseJarvisServerAddress(ADDRESS)).toEqual({ address: ADDRESS });
    expect(parseJarvisServerAddress('https://jarvis.example.com:8443')).toEqual({
      address: 'https://jarvis.example.com:8443',
    });
  });

  it('takes a bare host to mean https', () => {
    expect(parseJarvisServerAddress('jarvis.example.com')).toEqual({ address: ADDRESS });
    expect(parseJarvisServerAddress('jarvis.example.com:8443')).toEqual({ address: 'https://jarvis.example.com:8443' });
  });

  it('forgives the whitespace, the capitals and the trailing slash an address bar leaves', () => {
    expect(parseJarvisServerAddress('  HTTPS://Jarvis.Example.com/\n')).toEqual({ address: ADDRESS });
  });

  it('reads an empty field as no address, which is how the camera is switched off', () => {
    expect(parseJarvisServerAddress('')).toEqual({ address: undefined });
    expect(parseJarvisServerAddress('   ')).toEqual({ address: undefined });
  });

  it('takes http only for this very computer', () => {
    // A phone allows no cleartext traffic at all; a browser build tried against a server beside it does.
    expect(parseJarvisServerAddress('http://localhost:4111')).toEqual({ address: 'http://localhost:4111' });
    expect(parseJarvisServerAddress('http://127.0.0.1:4111/')).toEqual({ address: 'http://127.0.0.1:4111' });
    expect(parseJarvisServerAddress('http://jarvis.example.com')).toEqual({
      problem:
        "The Jarvis server's address has to start with https://. Only this computer (localhost) can use http://.",
    });
  });

  it('refuses a path, a query or a fragment, since the phone puts the server’s own paths after it', () => {
    for (const withMore of [
      'https://jarvis.example.com/api',
      'https://jarvis.example.com/api/photos/slots',
      'https://jarvis.example.com//',
      'https://jarvis.example.com?camera=on',
      'https://jarvis.example.com#photos',
    ]) {
      expect(parseJarvisServerAddress(withMore), withMore).toEqual({
        problem: "Give just the Jarvis server's address, with no path after it — like https://jarvis.example.com.",
      });
    }
  });

  it('refuses a user name or a password in it', () => {
    for (const withCredentials of ['https://sir:secret@jarvis.example.com', 'sir@jarvis.example.com']) {
      expect(parseJarvisServerAddress(withCredentials), withCredentials).toEqual({
        problem: "The Jarvis server's address takes no user name or password.",
      });
    }
  });

  it('refuses any scheme but https and http', () => {
    for (const elsewhere of ['ftp://jarvis.example.com', 'wss://jarvis.example.com', 'file:///etc/passwd']) {
      expect(parseJarvisServerAddress(elsewhere), elsewhere).toEqual({
        problem: "The Jarvis server's address starts with https://.",
      });
    }
  });

  it('refuses a port that is not one', () => {
    for (const badPort of ['https://jarvis.example.com:0', 'https://jarvis.example.com:65536', 'jarvis.example.com:']) {
      expect(parseJarvisServerAddress(badPort), badPort).toEqual({
        problem: "The Jarvis server's port should be a number from 1 to 65535.",
      });
    }
  });

  it('refuses what is not an address at all', () => {
    for (const notAnAddress of [
      'https://',
      'jarvis example com',
      'jarvis_server.example.com',
      '[::1]:4111',
      '-jarvis.com',
    ]) {
      expect(parseJarvisServerAddress(notAnAddress), notAnAddress).toEqual({
        problem: "The Jarvis server's address should look like https://jarvis.example.com.",
      });
    }
  });
});
