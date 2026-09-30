import type { PhotoProblem } from './photo-messages';

/**
 * Sending a photo to sir's Jarvis server: asking it for somewhere to send one, then sending it there,
 * and reading back what the server filed it as.
 *
 * **Two requests, both to the address in the phone's own settings** (`jarvis-server.ts`):
 *
 * 1. `POST <server>/api/photos/slots` with the id of the conversation the photo is for. The server
 *    asks ElevenLabs whether that conversation is in progress on Jarvis's agent, and only then opens a
 *    slot for one photo, good for a few minutes, answering with the path to send it to.
 * 2. `PUT <server><uploadPath>` with the JPEG. No key and no `Authorization` header: the slot's
 *    unguessable name is what lets the photo in, and it came straight from the server to this phone.
 *
 * **The server names a path, never where to go.** Only a path of exactly the upload route's shape is
 * used ({@link UPLOAD_PATH}), and it is put after the address sir typed — so nothing the server, or
 * anything pretending to be it, answers can send his photo to another host.
 *
 * **Never throws, and never repeats the server.** Every way it can go wrong — no network, Cloudflare
 * Access in the way, a conversation the server would not confirm — comes back as one of the phone's
 * own {@link PhotoProblem}s, for the agent to tell sir, and a description in the phone's own words for
 * its log. Nothing a response said is in either.
 *
 * **Never waits for ever, either.** Each request is given up on once {@link PHOTO_SLOT_WAIT_MS} or
 * {@link PHOTO_UPLOAD_WAIT_MS} has passed without an answer, and that too is a server that could not
 * be reached. See {@link givenUpOnAfter}.
 *
 * Imports nothing but a type, and takes `fetch` as an argument, for the reason `conversation-token.ts`
 * does: every answer the server can give, and every way the network can fail, is a test with no
 * device and no server behind it.
 */

/** The longest edge a photo is sent at, in pixels. Kept in step with `LONG_EDGE` in `JarvisPhotoActivity.kt`. */
export const PHOTO_LONG_EDGE = 1600;

/** The JPEG quality it is sent at, 0–1. Kept in step with `JPEG_QUALITY` in `JarvisPhotoActivity.kt`. */
export const PHOTO_QUALITY = 0.85;

/**
 * Where the phone asks for a slot, after the server's address. The server's `PHOTO_SLOTS_ROUTE`
 * (`mcp/mastra/verticals/api/routes.ts`), which `photo-upload.contract.spec.ts` holds this to.
 */
export const PHOTO_SLOTS_PATH = '/api/photos/slots';

/**
 * How long the slot request is waited on before it is given up.
 *
 * The server may ask ElevenLabs about the conversation three times over before it answers — five
 * seconds for each at most, a second and a half apart for the first two (`live-conversation.ts` in
 * `mcp/mastra/verticals/vision`), so 16.5 s at worst — and this leaves room for all of that and a slow
 * network besides.
 */
export const PHOTO_SLOT_WAIT_MS = 20_000;

/** How long the photo's upload is waited on before it is given up: a photo is a few hundred kilobytes. */
export const PHOTO_UPLOAD_WAIT_MS = 30_000;

/**
 * A path a photo may be sent to: the server's upload route and a slot's token — 22 URL-safe
 * characters, which is sixteen random bytes as the server mints them. Anything else is refused,
 * however much it looks like the server's.
 */
const UPLOAD_PATH = /^\/api\/photos\/[A-Za-z0-9_-]{22}$/;

/** What went wrong, for the agent to say (`problem`) and for the phone's log (`description`). */
export interface PhotoFailure {
  problem: PhotoProblem;
  description: string;
}

/** Somewhere to send the photo, or why there is not. */
export type PhotoSlot = { uploadPath: string } | PhotoFailure;

/** What the server filed the photo as, or why it did not get there. */
export type PhotoDelivery = { photoId: string } | PhotoFailure;

/** As much of `fetch` as a photo takes. */
type SendRequest = (url: string, init: RequestInit) => Promise<Response>;

/** The data in the Jarvis server's own JSON envelope, if this is one that says it succeeded. */
function readSuccessData(payload: unknown): object | undefined {
  if (typeof payload !== 'object' || payload === null || !('success' in payload) || payload.success !== true) {
    return undefined;
  }
  if (!('data' in payload) || typeof payload.data !== 'object' || payload.data === null) {
    return undefined;
  }
  return payload.data;
}

/** The response's JSON, or `undefined` if it had none. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Whether a refusal is the Jarvis server's own: its JSON envelope, saying it did not succeed.
 *
 * **A status alone is not enough to go on.** Cloudflare Access and the tunnel turn requests away too —
 * with a `403` of their own, or a `502` or `503` when the server behind them is down — and a phone that
 * read those as the server's answers would tell sir his conversation was not live, or his server had
 * photos switched off, when neither was so.
 */
async function isServerRefusal(response: Response): Promise<boolean> {
  const payload = await readJson(response);
  return typeof payload === 'object' && payload !== null && 'success' in payload && payload.success === false;
}

/** Nothing could be sent at all. */
const UNREACHABLE: PhotoFailure = {
  problem: 'unreachable',
  description: 'The Jarvis server could not be reached.',
};

/** A request that was sent, and never answered in the time it was given. */
function noAnswerWithin(waitMs: number): PhotoFailure {
  return {
    problem: 'unreachable',
    description: `The Jarvis server did not answer within ${waitMs / 1000} s.`,
  };
}

/**
 * Runs one request, and the reading of its answer, with a signal that aborts it once `waitMs` has
 * passed.
 *
 * **Nothing else would ever give up on it.** React Native's `fetch` on Android waits on OkHttp with
 * every timeout switched off, so a request the network swallowed — a connection gone half-open, a
 * server that stopped answering — would otherwise hold the camera button busy, and leave Jarvis
 * waiting on a photo, for as long as the call lasted. An abort makes `fetch` throw, which the request
 * answers as {@link noAnswerWithin}.
 *
 * A plain `AbortController` and `setTimeout`, not `AbortSignal.timeout`, which React Native does not
 * promise to have. The timer is cleared however the request ends, so none is left behind it.
 */
async function givenUpOnAfter<Answer>(
  waitMs: number,
  request: (signal: AbortSignal) => Promise<Answer>,
): Promise<Answer> {
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(), waitMs);
  try {
    return await request(giveUp.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nothing came back that could be read as the server's, whatever the status said.
 *
 * **A 200 is not enough.** Cloudflare Access answers a request it will not let through with its own
 * sign-in page, and that page is a 200 — so a photo the tunnel turned away would otherwise read as sent.
 */
const NOT_THE_SERVER: PhotoFailure = {
  problem: 'unreachable',
  description: 'The server answered with something that was not the Jarvis server.',
};

/** A refusal that was not the server's own, which is where Cloudflare Access usually is. */
function turnedAwayBefore(status: number): PhotoFailure {
  return {
    problem: 'unreachable',
    description: `Something in front of the Jarvis server answered ${status}. Cloudflare Access may need a bypass for /api/photos/*.`,
  };
}

/**
 * What a refused request means, by its status, by whose refusal it was, and by which of the two
 * requests was refused.
 *
 * Only the slot request can be refused for the conversation: the upload route checks nothing but the
 * slot's token, and answers a spent or unknown one with a 404 — so a 403 from it is always something
 * in front of the server.
 */
async function readRefusal(response: Response, request: 'slot' | 'upload'): Promise<PhotoFailure> {
  const { status } = response;
  if (status === 413) {
    return { problem: 'tooLarge', description: 'The photo was too large for the server.' };
  }
  if (!(await isServerRefusal(response))) {
    return turnedAwayBefore(status);
  }
  if (status === 403 && request === 'slot') {
    return {
      problem: 'notLive',
      description: 'The server could not confirm the conversation as live on Jarvis’s agent.',
    };
  }
  if (status === 503) {
    return { problem: 'switchedOff', description: 'Photo uploads are switched off on the server.' };
  }
  if (status === 404 && request === 'upload') {
    return { problem: 'unreachable', description: 'The upload slot had expired or been used already.' };
  }
  return { problem: 'unreachable', description: `The Jarvis server answered ${status}.` };
}

/**
 * Asks the Jarvis server for somewhere to send one photo, for the conversation under way. Never throws.
 *
 * Asked at the tap, while the conversation is certainly live — the call may drop while sir frames the
 * shot, and the slot, which lives for minutes, outlives that.
 */
export async function openPhotoSlot({
  serverAddress,
  conversationId,
  fetchImplementation = fetch,
}: {
  /** The server's origin, as `parseJarvisServerAddress` gives it. */
  serverAddress: string;
  /** The ElevenLabs id of the conversation under way, `conv_…`. */
  conversationId: string;
  fetchImplementation?: SendRequest;
}): Promise<PhotoSlot> {
  return givenUpOnAfter(PHOTO_SLOT_WAIT_MS, async (signal): Promise<PhotoSlot> => {
    let response: Response;
    try {
      response = await fetchImplementation(`${serverAddress}${PHOTO_SLOTS_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
        signal,
      });
    } catch {
      return signal.aborted ? noAnswerWithin(PHOTO_SLOT_WAIT_MS) : UNREACHABLE;
    }

    if (!response.ok) {
      return readRefusal(response, 'slot');
    }

    const data = readSuccessData(await readJson(response));
    const uploadPath = data && 'uploadPath' in data ? data.uploadPath : undefined;
    return typeof uploadPath === 'string' && UPLOAD_PATH.test(uploadPath) ? { uploadPath } : NOT_THE_SERVER;
  });
}

/**
 * Sends the photo, as a JPEG and nothing else, to the slot the server opened for it, and says what
 * became of it. Never throws: a photo that could not be sent is an outcome the agent is told about,
 * not a failed conversation.
 */
export async function sendPhoto({
  serverAddress,
  uploadPath,
  photo,
  fetchImplementation = fetch,
}: {
  /** The server's origin, as `parseJarvisServerAddress` gives it. */
  serverAddress: string;
  /** The path {@link openPhotoSlot} read back, checked again here since it decides where the photo goes. */
  uploadPath: string;
  photo: Blob;
  fetchImplementation?: SendRequest;
}): Promise<PhotoDelivery> {
  if (!UPLOAD_PATH.test(uploadPath)) {
    return NOT_THE_SERVER;
  }

  return givenUpOnAfter(PHOTO_UPLOAD_WAIT_MS, async (signal): Promise<PhotoDelivery> => {
    let response: Response;
    try {
      response = await fetchImplementation(`${serverAddress}${uploadPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: photo,
        signal,
      });
    } catch {
      return signal.aborted ? noAnswerWithin(PHOTO_UPLOAD_WAIT_MS) : UNREACHABLE;
    }

    if (!response.ok) {
      return readRefusal(response, 'upload');
    }

    const data = readSuccessData(await readJson(response));
    const photoId = data && 'photoId' in data ? data.photoId : undefined;
    return typeof photoId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(photoId) ? { photoId } : NOT_THE_SERVER;
  });
}
