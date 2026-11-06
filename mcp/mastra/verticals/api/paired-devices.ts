import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import { getPairedDeviceStorage, type PairedDeviceStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Pairing a device with this server, so that the server starts its conversations instead of the
 * device holding the ElevenLabs key.
 *
 * Made for the Quest headset, where the key would be typed on a virtual keyboard and kept in a
 * browser's storage, which anything on the page's origin can read. Paired, the headset holds a token
 * of this server's instead: it can do nothing but ask for one conversation at a time on Jarvis's own
 * agent, and sir can unpair it on its own, without revoking the key everything else uses.
 *
 * **Two paths, because Cloudflare Access treats them differently** (see "Pairing a device" in
 * `.claude/rules/mcp-mcp-server-access.md`):
 *
 * - **{@link DEVICE_PAIRING_PATH} stays behind Access.** Pairing is the one moment sir has to prove
 *   who he is, and he does it the way he already does on the headset: Access's login, whose
 *   `CF_Authorization` cookie the browser sends along. Whoever gets through Access may pair a device.
 * - **{@link PAIRED_DEVICE_PATH} bypasses Access.** A paired device presents its own token there, so it
 *   keeps working however long Access's session lasts. The token is the credential, checked here.
 */

/** Where a device is paired, listed and unpaired. Behind Cloudflare Access. */
export const DEVICE_PAIRING_PATH = '/api/devices';

/** One paired device, by its id: where it is unpaired. Behind Cloudflare Access. */
export const PAIRED_DEVICE_ROUTE = '/api/devices/:deviceId';

/**
 * Where the phone app pairs: a page sir opens in his phone's browser, behind Cloudflare Access like
 * the rest of {@link DEVICE_PAIRING_PATH}. A native app cannot hold Access's cookie, so it sends sir
 * through the browser's sign-in instead, and the page hands the token back to the app through its
 * own link ({@link PHONE_APP_PAIRED_URL}).
 */
export const PHONE_PAIRING_ROUTE = '/api/devices/pair';

/**
 * Where the pairing page sends the phone app its token: the app's own scheme (`scheme` in
 * `mobile/app.config.ts`), and never a link the request names, so the page can hand a token to
 * nothing but the app. The token is in the fragment, which a browser keeps out of every request.
 */
export const PHONE_APP_PAIRED_URL = 'heyjarvis://paired';

/** What the phone is listed as among the paired devices. */
const PHONE_DEVICE_NAME = 'Android phone';

/** Where a paired device asks for things with its own token. Bypasses Cloudflare Access. */
export const PAIRED_DEVICE_PATH = '/api/paired';

/** Where a paired device asks for one conversation's credential. */
export const PAIRED_CONVERSATION_ROUTE = '/api/paired/conversation';

/**
 * The pages allowed to pair a device and ask for a conversation from a browser: the web builds on
 * GitHub Pages (the phone's at the root, the headset's under `/vr/`, and every pull request's preview
 * under `/pr/<n>/`, all on the one origin), and the headset's dev server.
 *
 * Pairing is checked against these before anything is written, because a browser sends Access's
 * cookie with a simple cross-site `POST` from any page at all: without the check, a page sir happened
 * to open could pair devices he never sees. It could not read the token it was given — the browser
 * keeps the answer from a page the CORS headers do not name — but the device would be listed all the
 * same.
 */
export const WEB_APP_ORIGINS: readonly string[] = ['https://ffmathy.github.io', 'http://localhost:5173'];

/** The longest name a device is listed under. */
const MAX_DEVICE_NAME_LENGTH = 64;

/** What a device is listed under when it gives no name. */
const UNNAMED_DEVICE = 'A device';

/** How long ElevenLabs is given to mint a credential, before the device is told it could not. */
const ELEVENLABS_TIMEOUT_MS = 5_000;

/** The ElevenLabs endpoints that mint one conversation's credential, by the transport it is for. */
const ELEVENLABS_CREDENTIAL_URLS = {
  webrtc: 'https://api.elevenlabs.io/v1/convai/conversation/token',
  websocket: 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url',
} as const;

/**
 * What a paired device asks for: a WebRTC token for a spoken conversation, or a signed WebSocket URL
 * for a typed one, and the name it goes by in ElevenLabs' history (`jarvis-vr` for the headset).
 */
const conversationRequestSchema = z.object({
  transport: z.enum(['webrtc', 'websocket']),
  participantName: z.string().regex(/^jarvis-[a-z]{2,16}$/),
});

export type ConversationCredentialRequest = z.infer<typeof conversationRequestSchema>;

/** One conversation's credential, as the device dials with it. */
export type ConversationCredential = { token: string } | { signedUrl: string };

/** Why no credential could be minted, in words for the device to show. */
export class ConversationUnavailableError extends Error {}

/** Mints one conversation's credential on Jarvis's agent. */
export type MintConversationCredential = (request: ConversationCredentialRequest) => Promise<ConversationCredential>;

/** What the routes use of the paired devices' storage. */
export type PairedDeviceStore = Pick<PairedDeviceStorage, 'pair' | 'authenticate' | 'list' | 'unpair'>;

export interface PairedDeviceDependencies {
  store?: () => Promise<PairedDeviceStore>;
  mintConversationCredential?: MintConversationCredential;
}

const tokenResponseSchema = z.object({ token: z.string().min(1) });
const signedUrlResponseSchema = z.object({ signed_url: z.string().startsWith('wss://') });

/** A variable's value without the whitespace a pasted secret tends to pick up, or `undefined`. */
function readVariable(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** Asks ElevenLabs for the credential, and says it could not be reached rather than throwing `fetch`'s own error. */
async function askElevenLabs(
  fetchImplementation: typeof fetch,
  { transport, participantName }: ConversationCredentialRequest,
  { apiKey, agentId }: { apiKey: string; agentId: string },
): Promise<globalThis.Response> {
  const query = new URLSearchParams(
    transport === 'webrtc' ? { agent_id: agentId, participant_name: participantName } : { agent_id: agentId },
  );
  try {
    return await fetchImplementation(`${ELEVENLABS_CREDENTIAL_URLS[transport]}?${query}`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ConversationUnavailableError('Your Jarvis server could not reach ElevenLabs.', { cause: error });
  }
}

/** The credential in ElevenLabs' answer, for the transport it was asked for, or `undefined`. */
function credentialIn(transport: ConversationCredentialRequest['transport'], body: unknown) {
  if (transport === 'webrtc') {
    const parsed = tokenResponseSchema.safeParse(body);
    return parsed.success ? { token: parsed.data.token } : undefined;
  }
  const parsed = signedUrlResponseSchema.safeParse(body);
  return parsed.success ? { signedUrl: parsed.data.signed_url } : undefined;
}

/**
 * Asks ElevenLabs, with this server's key, for one conversation's credential on the agent sir's
 * devices talk to (`HEY_JARVIS_ELEVENLABS_AGENT_ID`, never the test agent).
 *
 * The response body is never logged or passed on whole: only the credential is read out of it.
 *
 * @param fetchImplementation - Injectable so the spec can answer for ElevenLabs.
 */
export function createElevenLabsCredentialMinter(
  fetchImplementation: typeof fetch = fetch,
): MintConversationCredential {
  return async (request) => {
    const apiKey = readVariable('HEY_JARVIS_ELEVENLABS_API_KEY');
    const agentId = readVariable('HEY_JARVIS_ELEVENLABS_AGENT_ID');
    if (!apiKey || !agentId) {
      throw new ConversationUnavailableError(
        'Your Jarvis server has no ElevenLabs key or agent to start a conversation with.',
      );
    }

    const response = await askElevenLabs(fetchImplementation, request, { apiKey, agentId });
    if (!response.ok) {
      logger.warn('[API] ElevenLabs refused a paired device its conversation', {
        status: response.status,
        transport: request.transport,
      });
      throw new ConversationUnavailableError(`ElevenLabs could not start a conversation (HTTP ${response.status}).`);
    }

    const credential = credentialIn(request.transport, await response.json().catch(() => undefined));
    if (credential === undefined) {
      throw new ConversationUnavailableError('ElevenLabs answered without a conversation credential.');
    }
    return credential;
  };
}

/** The origin a browser says a request comes from, when it is one of {@link WEB_APP_ORIGINS}. */
function allowedOrigin(request: Request): string | undefined {
  const origin = request.get('Origin');
  return origin !== undefined && WEB_APP_ORIGINS.includes(origin) ? origin : undefined;
}

/**
 * Lets the web builds pair a device with Access's cookie, and read the token it is answered with.
 * An explicit origin, never `*`, because a credentialed response may not name a wildcard.
 */
function allowWebAppsWithCredentials(request: Request, response: Response, next: NextFunction): void {
  const origin = allowedOrigin(request);
  response.vary('Origin');
  if (origin !== undefined) {
    response.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
  }
  next();
}

/** Lets the web builds ask for a conversation with a paired device's token. No cookie is involved. */
function allowWebAppsWithToken(request: Request, response: Response, next: NextFunction): void {
  const origin = allowedOrigin(request);
  response.vary('Origin');
  if (origin !== undefined) {
    response.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
  }
  next();
}

/** Answers a browser's preflight, which asks only which methods and headers may follow. */
function answerPreflight(_request: Request, response: Response): void {
  response.sendStatus(204);
}

/**
 * The name a pairing gives, sent as plain text so that the browser makes it a simple request: one
 * with no preflight, which Access would answer with its login page, since a preflight carries no
 * cookie.
 */
const readDeviceName = express.text({ type: () => true, limit: '1kb' });

/** The name to list a device under, from what it sent. */
function deviceNameOf(body: unknown): string {
  const name = typeof body === 'string' ? body.trim() : '';
  return name ? name.slice(0, MAX_DEVICE_NAME_LENGTH) : UNNAMED_DEVICE;
}

/** The bearer token a request carries, or `undefined`. */
function bearerTokenOf(request: Request): string | undefined {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(request.get('Authorization')?.trim() ?? '');
  return match?.[1];
}

/**
 * The page that asks sir to pair his phone. A button rather than pairing on the visit itself, so
 * that nothing is paired by a page that merely links here; and a form posting to its own origin, so
 * that {@link isSameOriginForm} can tell the press apart from one made elsewhere.
 */
const PHONE_PAIRING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair your phone with Jarvis</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #05070a; color: #e6f7ff;
    font: 18px/1.5 system-ui, sans-serif; }
  main { max-width: 22rem; padding: 1.5rem; text-align: center; }
  button { font: inherit; padding: 0.8rem 1.6rem; border: 0; border-radius: 999px; background: #38d6ff; color: #05070a; }
</style>
</head>
<body>
<main>
  <h1>Pair your phone</h1>
  <p>Your phone's Jarvis app will keep a token of this server's own, so it never has to sign in here again.</p>
  <form method="post" action="${PHONE_PAIRING_ROUTE}"><button type="submit">Pair and open Jarvis</button></form>
</main>
</body>
</html>`;

/**
 * Where the pairing page's form may go: here, and on to the app the press is redirected to. A browser
 * holds every redirect a form follows to `form-action`, so with `'self'` alone Chrome dropped the 303
 * to the app without a word, and the phone stayed on the page.
 */
const PAIRING_FORM_ACTION = `form-action 'self' ${new URL(PHONE_APP_PAIRED_URL).protocol}`;

/** Keeps the pairing page out of frames and caches: a button that pairs is not to be pressed blind. */
function guardPairingPage(response: Response): void {
  response.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; ${PAIRING_FORM_ACTION}; frame-ancestors 'none'`,
    // Not `no-referrer`: under it a browser sends a form's `Origin` as `null`, so a browser without
    // `Sec-Fetch-Site` could never pair. `same-origin` still sends no referrer to any other site.
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
}

/**
 * Whether a press of the pairing page's button came from the page itself, so that a form on any
 * other site posting here cannot pair devices sir never sees.
 *
 * **`Sec-Fetch-Site` decides, where a browser sends it**, as every current one does: the browser
 * sets it and no page can, and it says `same-origin` for the page's own button however the request
 * reaches the server. `Origin` cannot be the test there: a press under the old `no-referrer` page
 * arrived as `Origin: null` from Chrome on Android, and was refused. Only a browser without it falls
 * back to `Origin` naming this server's own `Host`.
 */
function isSameOriginForm(request: Request): boolean {
  const fetchSite = request.get('Sec-Fetch-Site');
  if (fetchSite !== undefined) return fetchSite === 'same-origin';
  const origin = request.get('Origin');
  const host = request.get('Host');
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Runs an async handler, handing whatever it throws to Express's error handler. */
function handle(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    handler(request, response).catch(next);
  };
}

/**
 * Registers pairing, listing and unpairing under {@link DEVICE_PAIRING_PATH}, and the paired devices'
 * own conversation endpoint under {@link PAIRED_DEVICE_PATH}.
 *
 * @returns The registered paths, for logging
 */
export function registerPairedDeviceApi(
  router: Router,
  {
    store = getPairedDeviceStorage,
    mintConversationCredential = createElevenLabsCredentialMinter(),
  }: PairedDeviceDependencies = {},
): string[] {
  router.options(DEVICE_PAIRING_PATH, allowWebAppsWithCredentials, answerPreflight);
  router.post(
    DEVICE_PAIRING_PATH,
    allowWebAppsWithCredentials,
    readDeviceName,
    handle(async (request, response) => {
      if (allowedOrigin(request) === undefined) {
        response.status(403).json({ success: false, message: 'Devices are paired from the Jarvis web apps only.' });
        return;
      }
      const { device, token } = await (await store()).pair(deviceNameOf(request.body));
      logger.info('[API] Device paired', { deviceId: device.id, name: device.name });
      response.status(201).json({ success: true, message: 'Device paired', data: { id: device.id, token } });
    }),
  );

  router.get(PHONE_PAIRING_ROUTE, (_request, response) => {
    guardPairingPage(response);
    response.type('html').send(PHONE_PAIRING_PAGE);
  });
  router.post(
    PHONE_PAIRING_ROUTE,
    handle(async (request, response) => {
      guardPairingPage(response);
      if (!isSameOriginForm(request)) {
        response.status(403).type('text').send('Pair your phone from the pairing page itself.');
        return;
      }
      const { device, token } = await (await store()).pair(PHONE_DEVICE_NAME);
      logger.info('[API] Device paired', { deviceId: device.id, name: device.name });
      response.redirect(303, `${PHONE_APP_PAIRED_URL}#${new URLSearchParams({ token })}`);
    }),
  );

  router.get(
    DEVICE_PAIRING_PATH,
    handle(async (_request, response) => {
      response.json({ success: true, message: 'Paired devices', data: await (await store()).list() });
    }),
  );

  router.delete(
    PAIRED_DEVICE_ROUTE,
    handle(async (request, response) => {
      const unpaired = await (await store()).unpair(String(request.params.deviceId));
      if (!unpaired) {
        response.status(404).json({ success: false, message: 'No device is paired with that id.' });
        return;
      }
      logger.info('[API] Device unpaired', { deviceId: request.params.deviceId });
      response.json({ success: true, message: 'Device unpaired' });
    }),
  );

  router.options(PAIRED_CONVERSATION_ROUTE, allowWebAppsWithToken, answerPreflight);
  router.post(
    PAIRED_CONVERSATION_ROUTE,
    allowWebAppsWithToken,
    handle(async (request, response) => {
      const token = bearerTokenOf(request);
      const device = token === undefined ? undefined : await (await store()).authenticate(token);
      if (device === undefined) {
        response.status(401).json({ success: false, message: 'This device is not paired with your Jarvis server.' });
        return;
      }

      const conversationRequest = conversationRequestSchema.safeParse(request.body);
      if (!conversationRequest.success) {
        response.status(400).json({
          success: false,
          message: 'Ask for {"transport": "webrtc" | "websocket", "participantName": "jarvis-…"}.',
        });
        return;
      }

      try {
        const credential = await mintConversationCredential(conversationRequest.data);
        response.json({ success: true, message: 'Conversation credential', data: credential });
      } catch (error) {
        if (!(error instanceof ConversationUnavailableError)) throw error;
        response.status(502).json({ success: false, message: error.message });
      }
    }),
  );

  logger.info('[API] Registered paired device endpoints', {
    pairing: DEVICE_PAIRING_PATH,
    conversation: PAIRED_CONVERSATION_ROUTE,
  });
  return [DEVICE_PAIRING_PATH, PHONE_PAIRING_ROUTE, PAIRED_CONVERSATION_ROUTE];
}
