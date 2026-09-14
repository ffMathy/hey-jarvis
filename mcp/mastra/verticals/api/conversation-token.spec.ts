import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import {
  CONVERSATION_TOKEN_PATH,
  type ConversationTokenMinter,
  createConversationTokenHandler,
  extractBearerToken,
} from './conversation-token.js';

const ACCESS_TOKEN = 'a-shared-secret-the-phone-holds';

/** A minter that records what it was asked for, so the tests can assert on it. */
function createRecordingMinter(): ConversationTokenMinter & { participantNames: string[] } {
  const participantNames: string[] = [];

  const minter = async (participantName: string) => {
    participantNames.push(participantName);
    return { token: 'a-webrtc-token', conversationId: 'conv_123' };
  };

  return Object.assign(minter, { participantNames });
}

/**
 * Starts a throwaway Express app carrying only the endpoint under test, so the
 * assertions run against the real routing and body parsing rather than a hand
 * built request object.
 */
async function startServer(mintToken: ConversationTokenMinter): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.post(CONVERSATION_TOKEN_PATH, createConversationTokenHandler(mintToken));

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to be listening on a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}${CONVERSATION_TOKEN_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('extractBearerToken', () => {
  it('reads the credential out of a bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('accepts the scheme in any casing, because HTTP schemes are case insensitive', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
    expect(extractBearerToken('BEARER abc123')).toBe('abc123');
  });

  it('ignores other authentication schemes', () => {
    expect(extractBearerToken('Basic abc123')).toBeUndefined();
  });

  it('returns nothing when there is no header, or no credential after the scheme', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
    expect(extractBearerToken('Bearer')).toBeUndefined();
    expect(extractBearerToken('Bearer   ')).toBeUndefined();
  });
});

describe('the conversation token endpoint', () => {
  const originalAccessToken = process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN;
  let server: { url: string; close: () => Promise<void> } | undefined;

  beforeEach(() => {
    process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN = ACCESS_TOKEN;
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;

    if (originalAccessToken === undefined) {
      delete process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN;
    } else {
      process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN = originalAccessToken;
    }
  });

  it('hands a token to a caller presenting the right bearer token', async () => {
    const minter = createRecordingMinter();
    server = await startServer(minter);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { token: 'a-webrtc-token', conversationId: 'conv_123' },
    });
  });

  it('names the participant so the conversation is recognisable in the history', async () => {
    const minter = createRecordingMinter();
    server = await startServer(minter);

    await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ participantName: 'pixel-9' }),
    });

    expect(minter.participantNames).toEqual(['pixel-9']);
  });

  it('falls back to a default participant name rather than an empty one', async () => {
    const minter = createRecordingMinter();
    server = await startServer(minter);

    await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ participantName: '   ' }),
    });

    expect(minter.participantNames).toEqual(['jarvis-mobile']);
  });

  it('rejects a request with no credential at all', async () => {
    const minter = createRecordingMinter();
    server = await startServer(minter);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(minter.participantNames).toEqual([]);
  });

  it('rejects a wrong credential of the same length, so the comparison is not a prefix check', async () => {
    const minter = createRecordingMinter();
    server = await startServer(minter);

    const wrongToken = `${ACCESS_TOKEN.slice(0, -1)}X`;
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${wrongToken}` },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(minter.participantNames).toEqual([]);
  });

  it('refuses to mint anything when no access token is configured, rather than letting everyone in', async () => {
    delete process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN;

    const minter = createRecordingMinter();
    server = await startServer(minter);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(503);
    expect(minter.participantNames).toEqual([]);
  });

  it('reports a failure to reach ElevenLabs without pretending it succeeded', async () => {
    server = await startServer(async () => {
      throw new Error('elevenlabs is down');
    });

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'elevenlabs is down' });
  });
});
