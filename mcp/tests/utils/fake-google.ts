import { getGoogleAuth } from '../../mastra/credentials/google-auth.js';

/**
 * Google's APIs, faked underneath the real googleapis client.
 *
 * The client, the requests it builds and the retries it makes are all real: only the HTTP transport
 * of the OAuth client `getGoogleAuth` hands out is swapped, for a function that answers each request.
 * So a spec sees exactly the requests a tool makes -- retries included, which is what a spec about
 * a lookup that must not hold up its tool needs to see -- with made-up credentials and without a
 * single request leaving the machine.
 *
 * Nothing global is replaced. Each fake gets a client of its own, so a request still running when its
 * spec ends goes on reaching that spec's fake and nobody else's.
 */

const GOOGLE_CREDENTIAL_ENV = [
  'HEY_JARVIS_GOOGLE_CLIENT_ID',
  'HEY_JARVIS_GOOGLE_CLIENT_SECRET',
  'HEY_JARVIS_GOOGLE_REFRESH_TOKEN',
] as const;

/** One request a tool made, as the fake is asked to answer it. */
export interface GoogleRequest {
  url: URL;
  init: RequestInit | undefined;
  /**
   * Never answers, the way a connection that hangs behaves: only the request's own timeout or the end
   * of the spec ends it. Ending with the spec is what keeps a lookup that was given up on from going
   * on retrying in the background while later specs run.
   */
  hang(): Promise<Response>;
}

/** How the fake answers one request. */
export type GoogleAnswer = (request: GoogleRequest) => Promise<Response> | Response;

export interface FakeGoogle {
  /** Every URL asked for, in order. */
  requests: URL[];
  /** Drops every request still hanging, and puts back the credentials the process had before. */
  restore(): void;
}

/** A JSON body, the way a Google API answers with one. */
export function googleJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

/** Has every Google API call made from here on answered by `answer`, until `restore` is called. */
export async function fakeGoogle(answer: GoogleAnswer): Promise<FakeGoogle> {
  const saved = new Map(GOOGLE_CREDENTIAL_ENV.map((name) => [name, process.env[name]]));
  process.env.HEY_JARVIS_GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET = 'test-client-secret';
  // A refresh token of its own, because getGoogleAuth hands back the client it last built for the
  // same token: a fresh one is what gets this fake a client nobody else holds.
  process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN = `test-refresh-token-${crypto.randomUUID()}`;

  const client = await getGoogleAuth();
  // Holding an access token that is nowhere near expiry, the client never asks for a new one, so
  // every request that reaches the transport is one a tool made.
  client.setCredentials({
    ...client.credentials,
    access_token: 'test-access-token',
    expiry_date: Date.now() + 3_600_000,
  });

  const requests: URL[] = [];
  const hanging = new Set<(reason: unknown) => void>();

  const hang = (init: RequestInit | undefined) =>
    new Promise<Response>((_resolve, reject) => {
      hanging.add(reject);
      init?.signal?.addEventListener('abort', () => {
        hanging.delete(reject);
        reject(init.signal?.reason);
      });
    });

  client.transporter.defaults.fetchImplementation = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      requests.push(url);
      return await answer({ url, init, hang: () => hang(init) });
    },
    { preconnect: globalThis.fetch.preconnect },
  );

  return {
    requests,
    restore() {
      // An abort, because that is the one failure Google's client never retries.
      for (const reject of hanging) {
        reject(new DOMException('The spec that faked this request has ended', 'AbortError'));
      }
      hanging.clear();

      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    },
  };
}
