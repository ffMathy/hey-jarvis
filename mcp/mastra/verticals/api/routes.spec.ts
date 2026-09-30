import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express, { type Request as ExpressRequest, type Response as ExpressResponse, type NextFunction } from 'express';
import type { Server } from 'http';
import { z } from 'zod';
import { createStep, createWorkflow, getWorkflowRuntime } from '../../utils/workflows/workflow-factory.js';
import {
  claimUploadSlot,
  findPhoto,
  forgetPhotos,
  MAX_PHOTO_BYTES,
  openUploadSlot,
  PHOTO_UPLOAD_KEY_VARIABLE,
  UPLOAD_SLOT_MS,
} from '../vision/index.js';
import {
  createWorkflowApiHandler,
  extractWorkflowError,
  PHOTO_UPLOAD_ROUTE,
  type RegisteredApiRoute,
  registerApiRoutes,
  registerWorkflowApi,
  withoutUploadToken,
} from './routes.js';

/**
 * A workflow that simply hands its input back, used to assert what a caller
 * receives on the happy path. The default on `quantity` also shows which parse
 * result the workflow actually runs on.
 */
const echoWorkflow = createWorkflow({
  id: 'echoWorkflow',
  inputSchema: z.object({
    prompt: z.string().min(1, 'Prompt is required'),
    quantity: z.number().default(1),
  }),
  outputSchema: z.object({ echoed: z.string(), quantity: z.number() }),
})
  .then(
    createStep({
      id: 'echo-step',
      inputSchema: z.object({ prompt: z.string(), quantity: z.number() }),
      outputSchema: z.object({ echoed: z.string(), quantity: z.number() }),
      execute: async ({ inputData }) => ({ echoed: inputData.prompt, quantity: inputData.quantity }),
    }),
  )
  .commit();

/** Two required fields, so a single empty body produces two validation issues. */
const twoFieldWorkflow = createWorkflow({
  id: 'twoFieldWorkflow',
  inputSchema: z.object({ first: z.string(), second: z.string() }),
  outputSchema: z.object({ joined: z.string() }),
})
  .then(
    createStep({
      id: 'join-step',
      inputSchema: z.object({ first: z.string(), second: z.string() }),
      outputSchema: z.object({ joined: z.string() }),
      execute: async ({ inputData }) => ({ joined: `${inputData.first}${inputData.second}` }),
    }),
  )
  .commit();

/** A nested schema, so validation issues carry a multi-segment path. */
const nestedWorkflow = createWorkflow({
  id: 'nestedWorkflow',
  inputSchema: z.object({ item: z.object({ name: z.string(), quantity: z.number() }) }),
  outputSchema: z.object({ name: z.string() }),
})
  .then(
    createStep({
      id: 'nested-step',
      inputSchema: z.object({ item: z.object({ name: z.string(), quantity: z.number() }) }),
      outputSchema: z.object({ name: z.string() }),
      execute: async ({ inputData }) => ({ name: inputData.item.name }),
    }),
  )
  .commit();

const FAILURE_MESSAGE = 'the greengrocer is closed';

const failingWorkflow = createWorkflow({
  id: 'failingWorkflow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ never: z.string() }),
})
  .then(
    createStep({
      id: 'failing-step',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ never: z.string() }),
      execute: async () => {
        throw new Error(FAILURE_MESSAGE);
      },
    }),
  )
  .commit();

const suspendingStep = createStep({
  id: 'always-suspends',
  description: 'Suspends, so the run ends without an error to report.',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  suspendSchema: z.object({}),
  execute: async ({ suspend }) => await suspend({}),
});

// Suspending persists a run snapshot, which needs a Mastra instance to persist through.
const suspendingWorkflow = createWorkflow({
  id: 'suspendingWorkflow',
  mastra: getWorkflowRuntime(),
  inputSchema: z.object({}),
  outputSchema: z.object({}),
})
  .then(suspendingStep)
  .commit();

/**
 * Returns a BigInt, which `res.json` cannot serialise. This is the realistic
 * shape of the handler's last-resort branch: libsql hands back row ids as
 * BigInt, so a step that forgets to convert one blows up during the response
 * rather than during the run.
 */
const unserialisableWorkflow = createWorkflow({
  id: 'unserialisableWorkflow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ rowId: z.bigint() }),
})
  .then(
    createStep({
      id: 'row-id-step',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ rowId: z.bigint() }),
      execute: async () => ({ rowId: 42n }),
    }),
  )
  .commit();

let server: Server;
let baseUrl: string;
let registeredWorkflowPaths: string[];
let registeredApiRoutes: RegisteredApiRoute[];
let forwardedError: unknown;

/** Errors the handler passes to `next` land here instead of Express's HTML page. */
const ERROR_HANDLER_STATUS = 503;

async function postJson(routePath: string, body: unknown) {
  return fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const workflowApiBodySchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

async function readBody(response: Response) {
  return workflowApiBodySchema.parse(await response.json());
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  const workflowRouter = express.Router();
  registeredWorkflowPaths = [
    registerWorkflowApi(workflowRouter, { path: '/api/echo', workflow: echoWorkflow }),
    registerWorkflowApi(workflowRouter, {
      path: '/api/two-fields',
      workflow: twoFieldWorkflow,
      description: 'Two required fields',
    }),
    registerWorkflowApi(workflowRouter, { path: '/api/nested', workflow: nestedWorkflow }),
    registerWorkflowApi(workflowRouter, { path: '/api/failing', workflow: failingWorkflow }),
  ];
  app.use(workflowRouter);

  // Mounted through a plain handler to prove the exported factory works on its
  // own, without `registerWorkflowApi` around it.
  app.post('/api/unserialisable', createWorkflowApiHandler(unserialisableWorkflow));

  const productionRouter = express.Router();
  registeredApiRoutes = registerApiRoutes(productionRouter);
  app.use(productionRouter);

  app.use((error: unknown, _request: ExpressRequest, response: ExpressResponse, _next: NextFunction) => {
    forwardedError = error;
    response.status(ERROR_HANDLER_STATUS).json({ forwarded: true });
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to be listening on a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  forwardedError = undefined;
});

describe('createWorkflowApiHandler', () => {
  describe('successful runs', () => {
    it('returns the workflow result under `data` with a success envelope', async () => {
      const response = await postJson('/api/echo', { prompt: 'buy milk' });
      const body = await readBody(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toBe('echoWorkflow completed successfully');
      expect(body.data).toEqual({ echoed: 'buy milk', quantity: 1 });
      expect(body.error).toBeUndefined();
    });

    it('lets the workflow apply schema defaults even though the handler forwards the raw body', async () => {
      // The handler validates `req.body` but then starts the run with the raw
      // body rather than the parsed value, so any default has to come from
      // Mastra's own re-validation. `quantity` proves that it does.
      const response = await postJson('/api/echo', { prompt: 'buy milk' });
      const body = await readBody(response);

      const echoed = z.object({ echoed: z.string(), quantity: z.number() }).parse(body.data);
      expect(echoed.quantity).toBe(1);
    });

    it('passes explicit values through untouched', async () => {
      const response = await postJson('/api/echo', { prompt: 'buy milk', quantity: 7 });
      const body = await readBody(response);

      expect(body.data).toEqual({ echoed: 'buy milk', quantity: 7 });
    });

    it('names the workflow in the success message', async () => {
      const response = await postJson('/api/two-fields', { first: 'a', second: 'b' });
      const body = await readBody(response);

      expect(body.message).toBe('twoFieldWorkflow completed successfully');
      expect(body.data).toEqual({ joined: 'ab' });
    });
  });

  describe('input validation', () => {
    it('rejects a missing field with 400 and names the field', async () => {
      const response = await postJson('/api/echo', {});
      const body = await readBody(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toStartWith('Validation failed: ');
      expect(body.message).toContain('prompt:');
      expect(body.data).toBeUndefined();
    });

    it('surfaces a custom Zod message', async () => {
      const response = await postJson('/api/echo', { prompt: '' });
      const body = await readBody(response);

      expect(response.status).toBe(400);
      expect(body.message).toBe('Validation failed: prompt: Prompt is required');
    });

    it('joins several issues with a comma', async () => {
      const response = await postJson('/api/two-fields', {});
      const body = await readBody(response);

      expect(response.status).toBe(400);
      // Zod's own messages contain commas too, so match the shape rather than
      // counting separators.
      expect(body.message).toMatch(/^Validation failed: first: .+, second: .+$/);
    });

    it('joins nested paths with a dot', async () => {
      const response = await postJson('/api/nested', { item: { name: 42, quantity: 1 } });
      const body = await readBody(response);

      expect(response.status).toBe(400);
      expect(body.message).toContain('item.name:');
    });

    it('leaves the path empty for an issue on the body itself', async () => {
      // A root-level issue has an empty path, so the formatter emits a bare
      // leading colon. Ugly, but it is the documented behaviour.
      const response = await postJson('/api/echo', [1, 2, 3]);
      const body = await readBody(response);

      expect(response.status).toBe(400);
      expect(body.message).toStartWith('Validation failed: : ');
      expect(body.message).toContain('expected object');
    });

    it('rejects a request with no body at all', async () => {
      const response = await fetch(`${baseUrl}/api/echo`, { method: 'POST' });
      const body = await readBody(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Validation failed');
    });

    it('does not start the workflow when validation fails', async () => {
      // A failing workflow that is never reached still returns 400, not 500.
      const response = await postJson('/api/failing', { prompt: 42 });

      expect(response.status).toBe(400);
    });
  });

  describe('workflow failures', () => {
    it('returns 500 with a failure envelope when the workflow does not succeed', async () => {
      const response = await postJson('/api/failing', { prompt: 'buy milk' });
      const body = await readBody(response);

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to execute failingWorkflow');
      expect(body.error).toBeDefined();
    });

    it('carries the step error message through to the caller', async () => {
      // This used to report nothing but the status: `extractWorkflowError` only
      // unwrapped `result.error` when it was an `Error` instance, and Mastra 1.58
      // reports `{ message, name }`. The real cause now reaches the caller.
      const response = await postJson('/api/failing', { prompt: 'buy milk' });
      const body = await readBody(response);

      expect(body.error).toBe(FAILURE_MESSAGE);
    });
  });

  describe('unexpected errors', () => {
    it('forwards a serialisation failure to the Express error handler', async () => {
      const response = await postJson('/api/unserialisable', { prompt: 'buy milk' });

      expect(response.status).toBe(ERROR_HANDLER_STATUS);
      expect(forwardedError).toBeInstanceOf(Error);
      expect((forwardedError as Error).message).toContain('BigInt');
    });

    it('does not forward anything on a normal request', async () => {
      await postJson('/api/echo', { prompt: 'buy milk' });

      expect(forwardedError).toBeUndefined();
    });
  });
});

describe('registerWorkflowApi', () => {
  it('returns the path it registered', () => {
    expect(registeredWorkflowPaths).toEqual(['/api/echo', '/api/two-fields', '/api/nested', '/api/failing']);
  });

  it('registers the endpoint for POST only', async () => {
    const getResponse = await fetch(`${baseUrl}/api/echo`);
    expect(getResponse.status).toBe(404);

    const putResponse = await fetch(`${baseUrl}/api/echo`, { method: 'PUT' });
    expect(putResponse.status).toBe(404);
  });

  it('leaves unregistered paths alone', async () => {
    const response = await postJson('/api/not-registered', { prompt: 'buy milk' });
    expect(response.status).toBe(404);
  });
});

describe('registerApiRoutes', () => {
  it('registers exactly the shopping list endpoint and the photo upload', () => {
    expect(registeredApiRoutes).toEqual([
      { method: 'POST', path: '/api/shopping-list' },
      { method: 'PUT', path: PHOTO_UPLOAD_ROUTE },
    ]);
  });

  it('validates the shopping list body before running the workflow', async () => {
    // Deliberately invalid: a valid prompt would run the real workflow, which
    // talks to an LLM and to the grocer's API.
    const response = await postJson('/api/shopping-list', {});
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Validation failed');
    expect(body.message).toContain('prompt');
  });

  it('rejects an empty prompt', async () => {
    const response = await postJson('/api/shopping-list', { prompt: '' });
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.message).toContain('Prompt is required');
  });

  it('answers POST only', async () => {
    const response = await fetch(`${baseUrl}/api/shopping-list`);
    expect(response.status).toBe(404);
  });
});

/**
 * On a failed run the API layer's only job is to tell the caller why it failed.
 *
 * Mastra serialises the error before the result leaves the engine, so the field the
 * handler reads holds a plain object rather than the `Error` its type promises. The
 * shapes `extractErrorMessage` has to understand are pinned next to it in
 * `utils/errors.spec.ts`; these tests pin what a real failing run actually produces.
 */
describe('extractWorkflowError', () => {
  it('surfaces the step failure from a real failed run', async () => {
    const run = await failingWorkflow.createRun();
    const result = await run.start({ inputData: { prompt: 'buy milk' } });

    expect(result.status).toBe('failed');
    expect(extractWorkflowError(result)).toBe(FAILURE_MESSAGE);
  });

  it('gets a plain object rather than an Error, which is why the naive check lost the message', async () => {
    const run = await failingWorkflow.createRun();
    const result = await run.start({ inputData: { prompt: 'buy milk' } });

    if (result.status !== 'failed') {
      throw new Error(`Expected the run to fail, but it reported ${result.status}.`);
    }

    // Mastra's types promise an `Error` here, but `toJSON` has already run by the time
    // the result reaches us, so an `instanceof Error` check finds nothing to report.
    expect(result.error).not.toBeInstanceOf(Error);
    expect(result.error).toMatchObject({ message: FAILURE_MESSAGE, name: 'Error' });
  });

  it('falls back to the status when the result carries no error at all', async () => {
    // A suspended run is the everyday non-success result with nothing to explain.
    const run = await suspendingWorkflow.createRun();
    const result = await run.start({ inputData: {} });

    expect(result.status).toBe('suspended');
    expect(extractWorkflowError(result)).toBe('Workflow failed with status suspended');
  });
});

describe('the photo upload', () => {
  /** A JPEG's first bytes, which is all the route looks at: it keeps what it is sent. */
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  /** The key this server is configured with for these tests, and the one the phone sends. */
  const PHOTO_UPLOAD_KEY = 'a-photo-upload-key-for-tests';

  const environmentKeys = [PHOTO_UPLOAD_KEY_VARIABLE] as const;
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

  /**
   * Sends a JPEG with exactly these headers, for the tests about what a request has to carry.
   *
   * **Each on a connection of its own** (`keepalive: false`). The route refuses most uploads before
   * reading them, and Bun's `fetch`, answered before it has finished sending a body, stops sending
   * it and still puts the connection back to be reused. The server, which is owed the rest of that
   * body, then took the next test's request as more of it, read what followed as a request line and
   * answered `400` — which CI saw as the 413 test's answer, when the refused upload was the 3 MB one
   * before it. A phone's HTTP client does not reuse a connection with a body half sent.
   */
  function putPhotoWith(uploadToken: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer> = JPEG) {
    return fetch(`${baseUrl}/api/photos/${uploadToken}`, { method: 'PUT', headers, body, keepalive: false });
  }

  /** Sends a photo as the phone does: with the key. */
  function putPhoto(uploadToken: string, body: Uint8Array<ArrayBuffer> = JPEG, contentType = 'image/jpeg') {
    return putPhotoWith(
      uploadToken,
      { 'Content-Type': contentType, Authorization: `Bearer ${PHOTO_UPLOAD_KEY}` },
      body,
    );
  }

  beforeEach(() => {
    forgetPhotos();
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = PHOTO_UPLOAD_KEY;
  });

  afterEach(() => {
    // The store is the process's: a photo left here would be brought up by another file's requests.
    forgetPhotos();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('is the path the phone checks an upload URL against', () => {
    expect(PHOTO_UPLOAD_ROUTE).toBe('/api/photos/:uploadToken');
  });

  it('keeps a photo sent to a slot, and says what it is called now', async () => {
    const { uploadToken } = openUploadSlot();

    const response = await putPhoto(uploadToken);

    expect(response.status).toBe(201);
    const body = await readBody(response);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ photoId: 'photo1' });
    expect(findPhoto('photo1')?.data).toEqual(Buffer.from(JPEG));
    expect(findPhoto('photo1')?.mediaType).toBe('image/jpeg');
  });

  it('takes one photo per slot', async () => {
    const { uploadToken } = openUploadSlot();
    expect((await putPhoto(uploadToken)).status).toBe(201);

    const again = await putPhoto(uploadToken);

    expect(again.status).toBe(404);
    expect(findPhoto('photo1')).toBeDefined();
    expect(findPhoto('photo2')).toBeUndefined();
  });

  it('turns away a slot nobody opened, and one that has closed', async () => {
    expect((await putPhoto('Q2hhbmdlIG1lIHBsZWFzZQ')).status).toBe(404);

    const { uploadToken } = openUploadSlot(Date.now() - UPLOAD_SLOT_MS - 1);
    expect((await putPhoto(uploadToken)).status).toBe(404);

    expect(findPhoto(undefined)).toBeUndefined();
  });

  it('turns a stranger away before reading what they sent', async () => {
    // Larger than any photo is allowed to be. Read first, this would be refused as too large; that
    // it is refused as a slot that does not exist is what says nothing was read.
    const tooLarge = new Uint8Array(MAX_PHOTO_BYTES + 1);

    expect((await putPhoto('Q2hhbmdlIG1lIHBsZWFzZQ', tooLarge)).status).toBe(404);
  });

  it('refuses a photo larger than a photo can be, even for a live slot', async () => {
    const { uploadToken } = openUploadSlot();

    const response = await putPhoto(uploadToken, new Uint8Array(MAX_PHOTO_BYTES + 1));

    // The body parser's own refusal, forwarded to the error handler with its status. Both at once,
    // so that a failure says which of the route's answers came back instead.
    expect({ status: response.status, forwarded: forwardedError }).toMatchObject({
      status: ERROR_HANDLER_STATUS,
      forwarded: { status: 413 },
    });
    expect(findPhoto(undefined)).toBeUndefined();
  });

  it('refuses anything that is not an image, without spending the slot', async () => {
    const { uploadToken } = openUploadSlot();

    expect((await putPhoto(uploadToken, new TextEncoder().encode('{"a":1}'), 'application/json')).status).toBe(415);
    expect((await putPhoto(uploadToken)).status).toBe(201);
  });

  it('refuses an empty body', async () => {
    const { uploadToken } = openUploadSlot();

    expect((await putPhoto(uploadToken, new Uint8Array(0))).status).toBe(415);
  });

  it('lets the browser build send from its own origin, with the key in a header', async () => {
    // A browser's preflight carries no key, so it must be answered without one.
    delete process.env[PHOTO_UPLOAD_KEY_VARIABLE];

    const preflight = await fetch(`${baseUrl}/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ`, { method: 'OPTIONS' });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');

    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = PHOTO_UPLOAD_KEY;

    const { uploadToken } = openUploadSlot();
    expect((await putPhoto(uploadToken)).headers.get('access-control-allow-origin')).toBe('*');
  });

  describe('the photo upload key', () => {
    /** What a refusal for want of the key looks like, whatever was missing from the request. */
    async function expectKeyRefused(response: Response) {
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="jarvis-photos"');
      // The phone tells a refused key from Cloudflare's refusals by this envelope.
      expect(await readBody(response)).toEqual({ success: false, message: 'This upload needs the photo upload key.' });
    }

    it('takes a photo that carries it, under the scheme in any case', async () => {
      const { uploadToken } = openUploadSlot();

      const response = await putPhotoWith(uploadToken, {
        'Content-Type': 'image/jpeg',
        Authorization: `bearer ${PHOTO_UPLOAD_KEY}`,
      });

      expect(response.status).toBe(201);
      expect(findPhoto('photo1')?.data).toEqual(Buffer.from(JPEG));
    });

    it('turns away an upload without it, saying which key and how to send it', async () => {
      const { uploadToken } = openUploadSlot();

      await expectKeyRefused(await putPhotoWith(uploadToken, { 'Content-Type': 'image/jpeg' }));
      expect(findPhoto(undefined)).toBeUndefined();
    });

    it('turns away the wrong key', async () => {
      const { uploadToken } = openUploadSlot();

      await expectKeyRefused(
        await putPhotoWith(uploadToken, {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${PHOTO_UPLOAD_KEY.slice(0, -1)}X`,
        }),
      );
      expect(findPhoto(undefined)).toBeUndefined();
    });

    it('turns away the right key under any scheme but Bearer', async () => {
      const { uploadToken } = openUploadSlot();

      await expectKeyRefused(
        await putPhotoWith(uploadToken, { 'Content-Type': 'image/jpeg', Authorization: `Basic ${PHOTO_UPLOAD_KEY}` }),
      );
      await expectKeyRefused(
        await putPhotoWith(uploadToken, { 'Content-Type': 'image/jpeg', Authorization: PHOTO_UPLOAD_KEY }),
      );
    });

    it('leaves the slot for the phone when an upload without it is turned away', async () => {
      // Otherwise anyone who saw the URL could not use it, but could still spend it before sir's phone.
      const { uploadToken } = openUploadSlot();
      await expectKeyRefused(await putPhotoWith(uploadToken, { 'Content-Type': 'image/jpeg' }));

      const response = await putPhoto(uploadToken);

      expect(response.status).toBe(201);
      expect(findPhoto('photo1')?.data).toEqual(Buffer.from(JPEG));
    });

    it('is asked for before anything else about the request, and before a byte of it is read', async () => {
      const { uploadToken } = openUploadSlot();

      // Neither a body too large to be a photo nor one that is not an image is looked at first. Not
      // JSON for the second: this test app parses JSON everywhere, which the MCP server does not.
      await expectKeyRefused(
        await putPhotoWith(uploadToken, { 'Content-Type': 'image/jpeg' }, new Uint8Array(MAX_PHOTO_BYTES + 1)),
      );
      await expectKeyRefused(await putPhotoWith(uploadToken, { 'Content-Type': 'text/plain' }));
      expect(forwardedError).toBeUndefined();
      expect(claimUploadSlot(uploadToken)).toBe(true);
    });

    it('switches uploads off, without touching a slot, when this server has no key', async () => {
      delete process.env[PHOTO_UPLOAD_KEY_VARIABLE];
      const { uploadToken } = openUploadSlot();

      const response = await putPhoto(uploadToken);

      expect(response.status).toBe(503);
      expect(await readBody(response)).toEqual({
        success: false,
        message: 'Photo uploads are switched off on this server.',
      });
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(findPhoto(undefined)).toBeUndefined();
      expect(claimUploadSlot(uploadToken)).toBe(true);
    });

    it('counts a configured key that is too short as none', async () => {
      process.env[PHOTO_UPLOAD_KEY_VARIABLE] = 'too-short';
      const { uploadToken } = openUploadSlot();

      const response = await putPhotoWith(uploadToken, {
        'Content-Type': 'image/jpeg',
        Authorization: 'Bearer too-short',
      });

      expect(response.status).toBe(503);
    });
  });

  it('keeps upload tokens out of the request log', () => {
    expect(withoutUploadToken('/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ')).toBe('/api/photos/…');
    expect(withoutUploadToken('/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ?x=1')).toBe('/api/photos/…?x=1');
    expect(withoutUploadToken('/api/shopping-list')).toBe('/api/shopping-list');
  });
});
