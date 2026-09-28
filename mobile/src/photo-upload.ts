/**
 * Sending a photo to the upload URL the agent handed over, and reading back what Mastra filed it as.
 *
 * Imports nothing, and takes `fetch` as an argument, for the reason `conversation-token.ts` does:
 * every answer the server can give — and every way the network can fail — is a test with no device
 * and no server behind it.
 */

/** The longest edge a photo is sent at, in pixels. Kept in step with `LONG_EDGE` in `JarvisPhotoActivity.kt`. */
export const PHOTO_LONG_EDGE = 1600;

/** The JPEG quality it is sent at, 0–1. Kept in step with `JPEG_QUALITY` in `JarvisPhotoActivity.kt`. */
export const PHOTO_QUALITY = 0.85;

/** Where the photo went, or why it did not get there. */
export type PhotoDelivery = { photoId: string } | { problem: string };

/** As much of `fetch` as sending a photo takes. */
type SendRequest = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The id Mastra filed the photo under, read from its answer without trusting its shape.
 *
 * **A 200 is not enough.** Cloudflare Access answers a request it will not let through with its own
 * sign-in page, and that page is a 200 — so a photo the tunnel turned away would otherwise read as
 * sent. Only Mastra's own envelope with an id in it counts.
 */
function readPhotoId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('success' in payload) || payload.success !== true) {
    return undefined;
  }
  if (!('data' in payload) || typeof payload.data !== 'object' || payload.data === null) {
    return undefined;
  }

  const { data } = payload;
  const photoId = 'photoId' in data ? data.photoId : undefined;
  return typeof photoId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(photoId) ? photoId : undefined;
}

/**
 * Why a photo did not arrive, in words for sir's log rather than for the agent.
 *
 * The agent is only ever told that it did not — see `PHOTO_NOT_SENT` — and never anything from the
 * response, which is not the agent's to read.
 */
function describeFailure(status: number): string {
  if (status === 404) {
    return 'The upload link had expired or been used already.';
  }
  if (status === 413) {
    return 'The photo was too large for the server.';
  }
  if (status === 401 || status === 403) {
    return 'The server turned the photo away. Cloudflare Access may need a bypass for /api/photos.';
  }
  return `The server answered ${status}.`;
}

/**
 * Sends the photo, as a JPEG, and says what became of it. Never throws: a photo that could not be
 * sent is an outcome the agent is told about, not a failed conversation.
 */
export async function sendPhoto({
  photo,
  uploadUrl,
  fetchImplementation = fetch,
}: {
  photo: Blob;
  uploadUrl: string;
  fetchImplementation?: SendRequest;
}): Promise<PhotoDelivery> {
  let response: Response;
  try {
    response = await fetchImplementation(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: photo,
    });
  } catch {
    return { problem: 'The server could not be reached.' };
  }

  if (!response.ok) {
    return { problem: describeFailure(response.status) };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { problem: 'The server answered with something that was not Mastra.' };
  }

  const photoId = readPhotoId(payload);
  return photoId ? { photoId } : { problem: 'The server answered with something that was not Mastra.' };
}
