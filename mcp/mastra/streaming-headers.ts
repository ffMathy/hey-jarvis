/**
 * Response-header hygiene for streaming routes.
 *
 * Kept in its own module so it can be exercised in isolation, without importing
 * `index.ts` and booting every agent and workflow.
 */

/**
 * The part of a Hono context this middleware touches.
 *
 * Deliberately structural rather than Hono's own `MiddlewareHandler`: `@mastra/core`
 * vendors its own copy of the Hono types, so a handler annotated with one package's
 * `Context` will not typecheck against the other's. Naming only what is used keeps the
 * handler assignable to both `app.use()` and Mastra's `server.middleware`.
 */
type ResponseContext = { res: Response };

/**
 * Removes the `Transfer-Encoding` header the application sets on streaming responses,
 * leaving the framing to the HTTP server.
 *
 * `@mastra/hono` sets `Transfer-Encoding: chunked` itself on every route with
 * `responseType: 'stream'` — agent streams, thread subscriptions, workflow watches. The
 * HTTP server then adds the same header again when it frames a body that has no
 * `Content-Length`, and Bun emitted both copies up to and including 1.3.9. A browser
 * shrugs that off. Go's `net/http` does not:
 *
 * ```text
 * too many transfer encodings: ["chunked" "chunked"]
 * ```
 *
 * That is the client `cloudflared` uses to reach the origin, so through the tunnel every
 * streaming route died before its first byte and Cloudflare answered the browser with a
 * 502 page, while ordinary JSON routes kept working — the failure looked like a dead
 * server rather than a malformed response.
 *
 * Deleting the header costs nothing: chunked framing is what an HTTP/1.1 server does for
 * a body of unknown length whether or not the header was declared, so the response goes
 * out chunked either way, with exactly one header announcing it.
 */
export const stripTransferEncodingHeader = async (c: ResponseContext, next: () => Promise<void>): Promise<void> => {
  await next();
  c.res.headers.delete('Transfer-Encoding');
};
