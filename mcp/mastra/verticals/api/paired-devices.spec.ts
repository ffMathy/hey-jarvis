import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import express from 'express';
import { mkdtemp, rm } from 'fs/promises';
import type { Server } from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { PairedDeviceStorage, tokenFingerprint } from '../../storage/paired-devices.js';
import { logger } from '../../utils/logger.js';
import {
  type ConversationCredentialRequest,
  ConversationUnavailableError,
  createElevenLabsCredentialMinter,
  DEVICE_PAIRING_PATH,
  type MintConversationCredential,
  PAIRED_CONVERSATION_ROUTE,
  PHONE_APP_PAIRED_URL,
  PHONE_PAIRING_ROUTE,
  registerPairedDeviceApi,
} from './paired-devices.js';

/** A fake of `fetch`: Bun's carries `preconnect` beside its call signature, so a bare function is not one. */
function fakeFetch(answer: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(answer, { preconnect: fetch.preconnect });
}

const HEADSET_PAGE = 'https://ffmathy.github.io';
const STRANGER_PAGE = 'https://evil.example';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'paired-devices-'));
let databaseCount = 0;
let storage: PairedDeviceStorage;
let minted: ConversationCredentialRequest[] = [];
let mint: MintConversationCredential;
let server: Server;
let baseUrl: string;

beforeEach(() => {
  databaseCount++;
  storage = new PairedDeviceStorage(path.join(databaseDirectory, `paired-${databaseCount}.db`));
  minted = [];
  mint = async (request) => {
    minted.push(request);
    return request.transport === 'webrtc' ? { token: 'livekit-token' } : { signedUrl: 'wss://example/signed' };
  };
});

beforeAll(async () => {
  const app = express();
  // The server's own JSON parser runs in front of every route, as in `mcp-server.ts`.
  app.use(express.json());
  const router = express.Router();
  registerPairedDeviceApi(router, {
    store: async () => storage,
    mintConversationCredential: (request) => mint(request),
  });
  app.use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await rm(databaseDirectory, { force: true, recursive: true });
});

/** Pairs as the headset's page does: a simple request, plain text, from the page's origin. */
function pair(name: string, origin: string | null = HEADSET_PAGE) {
  return fetch(`${baseUrl}${DEVICE_PAIRING_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...(origin === null ? {} : { Origin: origin }) },
    body: name,
  });
}

async function pairedToken(name = 'Quest 3'): Promise<string> {
  const response = await pair(name);
  const { data } = (await response.json()) as { data: { token: string } };
  return data.token;
}

function askForConversation(token: string | undefined, body: object) {
  return fetch(`${baseUrl}${PAIRED_CONVERSATION_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: HEADSET_PAGE },
    body: JSON.stringify(token === undefined ? body : { ...body, deviceToken: token }),
  });
}

describe('pairing a device', () => {
  it('hands the page a token it can read, and lists the device without it', async () => {
    const response = await pair('Quest 3');

    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(HEADSET_PAGE);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    const { data } = (await response.json()) as { data: { id: string; token: string } };
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const listed = await (await fetch(`${baseUrl}${DEVICE_PAIRING_PATH}`)).json();
    expect(listed.data).toEqual([
      {
        id: data.id,
        name: 'Quest 3',
        pairedAt: expect.any(String),
        lastUsedAt: null,
        tokenFingerprint: tokenFingerprint(data.token),
      },
    ]);
    expect(listed.server).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(listed)).not.toContain(data.token);
  });

  it('pairs nothing for a page that is not one of the web apps', async () => {
    const response = await pair('Not mine', STRANGER_PAGE);

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('pairs nothing for a request that names no page', async () => {
    expect((await pair('Not mine', null)).status).toBe(403);
    expect(await storage.list()).toEqual([]);
  });

  it('lists a device that gives no name under a name of its own', async () => {
    await pair('   ');
    expect((await storage.list()).map((device) => device.name)).toEqual(['A device']);
  });
});

describe('a paired device asking for a conversation', () => {
  it('is minted a token for a spoken conversation, under its own name', async () => {
    const token = await pairedToken();

    const response = await askForConversation(token, { transport: 'webrtc', participantName: 'jarvis-vr' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(HEADSET_PAGE);
    expect((await response.json()).data).toEqual({ token: 'livekit-token' });
    expect(minted).toEqual([{ transport: 'webrtc', participantName: 'jarvis-vr' }]);
    expect((await storage.list())[0]?.lastUsedAt).not.toBeNull();
  });

  it('is minted a signed URL for a typed conversation', async () => {
    const token = await pairedToken();

    const response = await askForConversation(token, { transport: 'websocket', participantName: 'jarvis-vr' });

    expect((await response.json()).data).toEqual({ signedUrl: 'wss://example/signed' });
  });

  it('is refused without a token, and with one nobody was given', async () => {
    const withNone = await askForConversation(undefined, { transport: 'webrtc', participantName: 'jarvis-vr' });
    const withMadeUp = await askForConversation('a'.repeat(43), { transport: 'webrtc', participantName: 'jarvis-vr' });

    expect([withNone.status, withMadeUp.status]).toEqual([401, 401]);
    expect(minted).toEqual([]);
  });

  it('logs why a device was refused, and which server paired and refused it, never the token', async () => {
    const paired = spyOn(logger, 'info');
    const refused = spyOn(logger, 'warn');
    try {
      const token = await pairedToken();
      const madeUp = 'b'.repeat(43);
      await askForConversation(madeUp, { transport: 'webrtc', participantName: 'jarvis-vr' });
      await askForConversation(undefined, { transport: 'webrtc', participantName: 'jarvis-vr' });

      const pairing = paired.mock.calls.find(([message]) => message === '[API] Device paired')?.[1];
      const refusals = refused.mock.calls
        .filter(([message]) => message === '[API] Refused a device its conversation')
        .map(([, details]) => details);

      expect(pairing).toMatchObject({ token: tokenFingerprint(token) });
      expect(refusals).toEqual([
        { reason: 'unknown token', token: tokenFingerprint(madeUp), server: expect.any(String) },
        { reason: 'no device token', server: expect.any(String) },
      ]);
      expect(new Set([pairing?.server, ...refusals.map((details) => details?.server)]).size).toBe(1);
      const logged = JSON.stringify([...paired.mock.calls, ...refused.mock.calls]);
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(madeUp);
    } finally {
      paired.mockRestore();
      refused.mockRestore();
    }
  });

  it('tells a refused device why, and which server refused it, to set beside the device list', async () => {
    const token = await pairedToken();
    const madeUp = 'c'.repeat(43);

    const refused = await askForConversation(madeUp, { transport: 'webrtc', participantName: 'jarvis-vr' });
    const body = await refused.json();
    const listed = await (await fetch(`${baseUrl}${DEVICE_PAIRING_PATH}`)).json();

    expect(refused.status).toBe(401);
    expect(body.details).toEqual({ reason: 'unknown token', token: tokenFingerprint(madeUp), server: listed.server });
    expect(listed.data.map((device: { tokenFingerprint: string }) => device.tokenFingerprint)).toEqual([
      tokenFingerprint(token),
    ]);
    expect(JSON.stringify(body)).not.toContain(madeUp);
  });

  it('is refused once it has been unpaired', async () => {
    const pairing = await (await pair('Lost headset')).json();

    const unpaired = await fetch(`${baseUrl}${DEVICE_PAIRING_PATH}/${pairing.data.id}`, { method: 'DELETE' });
    const response = await askForConversation(pairing.data.token, {
      transport: 'webrtc',
      participantName: 'jarvis-vr',
    });

    expect(unpaired.status).toBe(200);
    expect(response.status).toBe(401);
    expect(minted).toEqual([]);
  });

  it('says what went wrong when no conversation can be had', async () => {
    const token = await pairedToken();
    mint = async () => {
      throw new ConversationUnavailableError('ElevenLabs could not start a conversation (HTTP 402).');
    };

    const response = await askForConversation(token, { transport: 'webrtc', participantName: 'jarvis-vr' });

    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe('ElevenLabs could not start a conversation (HTTP 402).');
  });

  it('is refused a name that is not one of the devices', async () => {
    const token = await pairedToken();

    const response = await askForConversation(token, { transport: 'webrtc', participantName: 'anything&agent_id=x' });

    expect(response.status).toBe(400);
    expect(minted).toEqual([]);
  });

  it('answers the preflight its JSON body needs', async () => {
    const preflight = await fetch(`${baseUrl}${PAIRED_CONVERSATION_ROUTE}`, {
      method: 'OPTIONS',
      headers: { Origin: HEADSET_PAGE, 'Access-Control-Request-Headers': 'content-type' },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('is given its conversation with the token in the body, as whatever stands in front hands it over', async () => {
    // What the phone's refusal showed on the live server: the request arrived, body and all, with no
    // Authorization header. The token goes in the body, which arrives as it was sent.
    const token = await pairedToken();

    const response = await fetch(`${baseUrl}${PAIRED_CONVERSATION_ROUTE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: token, transport: 'webrtc', participantName: 'jarvis-android' }),
    });

    expect(response.status).toBe(200);
    expect(minted).toEqual([{ transport: 'webrtc', participantName: 'jarvis-android' }]);
  });

  it('says what it was sent in place of a token, by its length and never its value', async () => {
    const refused = await askForConversation('not a token!', { transport: 'webrtc', participantName: 'jarvis-vr' });

    expect((await refused.json()).details).toEqual({
      reason: 'not a device token',
      length: 'not a token!'.length,
      server: expect.any(String),
    });
  });
});

describe('minting with ElevenLabs', () => {
  const variables = ['HEY_JARVIS_ELEVENLABS_API_KEY', 'HEY_JARVIS_ELEVENLABS_AGENT_ID'] as const;
  const saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    process.env.HEY_JARVIS_ELEVENLABS_API_KEY = 'sk_server-key';
    process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID = 'agent_01jz';
  });

  afterAll(() => {
    for (const name of variables) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('asks for the agent with the server key, under the device name', async () => {
    const asked: { url: string; key: string | null }[] = [];
    const minter = createElevenLabsCredentialMinter(
      fakeFetch(async (url, init) => {
        asked.push({ url: String(url), key: new Headers(init?.headers).get('xi-api-key') });
        return Response.json({ token: 'livekit-token', conversation_id: 'conv_1' });
      }),
    );

    expect(await minter({ transport: 'webrtc', participantName: 'jarvis-vr' })).toEqual({ token: 'livekit-token' });
    expect(asked).toEqual([
      {
        url: 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_01jz&participant_name=jarvis-vr',
        key: 'sk_server-key',
      },
    ]);
  });

  it('refuses a signed URL that is not a wss:// one', async () => {
    const minter = createElevenLabsCredentialMinter(fakeFetch(async () => Response.json({ signed_url: 'ws://plain' })));

    await expect(minter({ transport: 'websocket', participantName: 'jarvis-vr' })).rejects.toBeInstanceOf(
      ConversationUnavailableError,
    );
  });

  it('says ElevenLabs could not be reached when the request never got an answer', async () => {
    const minter = createElevenLabsCredentialMinter(
      fakeFetch(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(minter({ transport: 'webrtc', participantName: 'jarvis-vr' })).rejects.toThrow(
      'Your Jarvis server could not reach ElevenLabs.',
    );
  });

  it('starts nothing on a server without the agent', async () => {
    delete process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    const minter = createElevenLabsCredentialMinter(
      fakeFetch(async () => {
        throw new Error('ElevenLabs should not have been asked');
      }),
    );

    await expect(minter({ transport: 'webrtc', participantName: 'jarvis-vr' })).rejects.toBeInstanceOf(
      ConversationUnavailableError,
    );
  });
});

describe('pairing the phone through its browser', () => {
  function pressPair(headers: Record<string, string>) {
    return fetch(`${baseUrl}${PHONE_PAIRING_ROUTE}`, { method: 'POST', headers, redirect: 'manual' });
  }

  it('shows a page with a button, kept out of frames and caches', async () => {
    const response = await fetch(`${baseUrl}${PHONE_PAIRING_ROUTE}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toContain(`<form method="post" action="${PHONE_PAIRING_ROUTE}">`);
    expect(await storage.list()).toEqual([]);
  });

  it('pairs the phone when the page’s own button is pressed, and hands the app its token', async () => {
    const host = new URL(baseUrl).host;
    const response = await pressPair({ Origin: `https://${host}`, Host: host, 'Sec-Fetch-Site': 'same-origin' });

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(`${location.protocol}//${location.host}`).toBe(PHONE_APP_PAIRED_URL);
    const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await storage.authenticate(token)).toMatchObject({ name: 'Android phone' });
  });

  it('pairs the phone for the press a browser really sends from the page, behind the tunnel', async () => {
    // What Chrome on Android sent: a form posted under a no-referrer page carries `Origin: null`
    // (the Fetch standard serialises the origin as null for that policy), and cloudflared hands the
    // server a Host of its own service rather than the public hostname. Sec-Fetch-Site still says
    // the press came from the page itself, and a page cannot forge it.
    const originHidden = await pressPair({ Origin: 'null', 'Sec-Fetch-Site': 'same-origin' });
    const hostRewritten = await pressPair({
      Origin: 'https://jarvis.example.com',
      Host: 'localhost:4112',
      'Sec-Fetch-Site': 'same-origin',
    });

    expect([originHidden.status, hostRewritten.status]).toEqual([303, 303]);
    expect(await storage.list()).toHaveLength(2);
  });

  it('lets the page’s form be sent on to the app, which a browser holds to the form-action policy', async () => {
    // A browser applies `form-action` to every redirect a form's submission follows, not only to
    // its action: with `'self'` alone, Chrome dropped the 303 to the app's scheme without a word.
    const page = await fetch(`${baseUrl}${PHONE_PAIRING_ROUTE}`);
    const formAction = (page.headers.get('Content-Security-Policy') ?? '')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .find(([name]) => name === 'form-action');
    const appScheme = new URL(PHONE_APP_PAIRED_URL).protocol;

    expect(formAction).toContain("'self'");
    expect(formAction).toContain(appScheme);
  });

  it('shows the pairing page with a referrer policy that keeps the press’s origin', async () => {
    const response = await fetch(`${baseUrl}${PHONE_PAIRING_ROUTE}`);

    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('pairs nothing for a press from another site', async () => {
    const host = new URL(baseUrl).host;
    const fromElsewhere = await pressPair({ Origin: STRANGER_PAGE, 'Sec-Fetch-Site': 'cross-site' });
    const withNoOrigin = await pressPair({});
    const sameHostCrossSite = await pressPair({ Origin: `https://${host}`, 'Sec-Fetch-Site': 'cross-site' });

    expect([fromElsewhere.status, withNoOrigin.status, sameHostCrossSite.status]).toEqual([403, 403, 403]);
    expect(await storage.list()).toEqual([]);
  });
});
