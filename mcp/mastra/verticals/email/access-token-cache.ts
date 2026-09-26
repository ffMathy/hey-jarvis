/** An access token, and when it stops being accepted. `null` when the issuer did not say. */
export interface IssuedAccessToken {
  accessToken: string;
  expiresOn: Date | null;
}

/**
 * How long before its expiry a token is replaced rather than handed out.
 *
 * Wide enough that a token handed to a tool call cannot expire during it -- a Graph request plus
 * the model deciding on it takes seconds, not minutes.
 */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/**
 * Reuses an access token for as long as it is valid, instead of acquiring one per request.
 *
 * Every email tool used to exchange the refresh token first: a fresh MSAL client, an authority
 * lookup and a token request, two round trips to Microsoft before Graph was asked anything, on
 * every tool call and on the email check that runs every minute. A token lasts about an hour,
 * so this acquires one about once an hour.
 *
 * Concurrent callers share one acquisition. A failed acquisition is not remembered, so the next
 * call tries again; a token without an expiry is used by the calls waiting on it but not kept.
 *
 * @param acquire - Acquires a new token; called only when there is no usable one
 */
export function createAccessTokenCache(acquire: () => Promise<IssuedAccessToken>) {
  let cached: { accessToken: string; usableUntil: number } | undefined;
  let acquisition: Promise<string> | undefined;

  return {
    async get(): Promise<string> {
      if (cached && Date.now() < cached.usableUntil) {
        return cached.accessToken;
      }

      acquisition ??= acquire()
        .then(({ accessToken, expiresOn }) => {
          cached = expiresOn ? { accessToken, usableUntil: expiresOn.getTime() - EXPIRY_MARGIN_MS } : undefined;
          return accessToken;
        })
        .finally(() => {
          acquisition = undefined;
        });

      return await acquisition;
    },
  };
}
