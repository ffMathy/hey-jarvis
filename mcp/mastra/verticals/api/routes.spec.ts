import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express, { type Request as ExpressRequest, type Response as ExpressResponse, type NextFunction } from 'express';
import type { Server } from 'http';
import { z } from 'zod';
import { createStep, createWorkflow, getWorkflowRuntime } from '../../utils/workflows/workflow-factory.js';
import {
  type ConversationVerdict,
  claimUploadSlot,
  findPhoto,
  forgetPhotos,
  MAX_OPEN_SLOTS,
  MAX_PHOTO_BYTES,
  openUploadSlot,
  UPLOAD_SLOT_MS,
} from '../vision/index.js';
import {
  createWorkflowApiHandler,
  extractWorkflowError,
  MCP_PATH,
  PHOTO_SLOTS_ROUTE,
  PHOTO_UPLOAD_PATH,
  PHOTO_UPLOAD_ROUTE,
  type RegisteredApiRoute,
  readsItsOwnBody,
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

/**
 * What the stand-in for the live-conversation check answers, and every id it was asked about.
 *
 * The check itself — ElevenLabs, its retries, its limits — is `vision/live-conversation.spec.ts`'s;
 * what is tested here is how the route answers each thing it can find.
 */
let conversationVerdict: ConversationVerdict = 'live';
const conversationsChecked: string[] = [];
/** Whom each of those checks was asked on behalf of, in the same order. */
const sourcesAsking: string[] = [];

async function checkConversation(conversationId: string, source: string): Promise<ConversationVerdict> {
  conversationsChecked.push(conversationId);
  sourcesAsking.push(source);
  return conversationVerdict;
}

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
  // As the MCP server does it (`mcp-server.ts`), with the same check: JSON everywhere but the routes
  // that read their own bodies, if at all.
  const parseJson = express.json();
  app.use((request, response, next) => {
    if (readsItsOwnBody(request.path)) {
      next();
    } else {
      parseJson(request, response, next);
    }
  });

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
  registeredApiRoutes = registerApiRoutes(productionRouter, { isLiveJarvisConversation: checkConversation });
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
  conversationVerdict = 'live';
  conversationsChecked.length = 0;
  sourcesAsking.length = 0;
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
  it('registers exactly the shopping list endpoint, the photo slots and the photo upload', () => {
    expect(registeredApiRoutes).toEqual([
      { method: 'POST', path: '/api/shopping-list' },
      { method: 'POST', path: PHOTO_SLOTS_ROUTE },
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

/** A JPEG's first bytes, which is all the upload route looks at: it keeps what it is sent. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** A conversation id of the shape ElevenLabs gives one. */
const CONVERSATION_ID = 'conv_01jz8k3b4c5d6e7f';

/**
 * Every photo request goes **on a connection of its own** (`keepalive: false`). These routes refuse
 * most requests before reading them, and Bun's `fetch`, answered before it has finished sending a
 * body, stops sending it and still puts the connection back to be reused. The server, which is owed
 * the rest of that body, then took the next test's request as more of it, read what followed as a
 * request line and answered `400` — which CI saw as the 413 test's answer, when the refused upload
 * was the 3 MB one before it. A phone's HTTP client does not reuse a connection with a body half
 * sent.
 */
function putPhotoWith(uploadToken: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer> = JPEG) {
  return fetch(`${baseUrl}${PHOTO_UPLOAD_PATH}/${uploadToken}`, { method: 'PUT', headers, body, keepalive: false });
}

/** Sends a photo as the phone does: a JPEG, and nothing else — no key, no credentials. */
function putPhoto(uploadToken: string, body: Uint8Array<ArrayBuffer> = JPEG, contentType = 'image/jpeg') {
  return putPhotoWith(uploadToken, { 'Content-Type': contentType }, body);
}

/** Asks for a photo slot at this path, however it is spelled, with these headers and this body. */
function postToSlotPath(path: string, headers: Record<string, string>, body: string) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body, keepalive: false });
}

/** Asks for a photo slot as the phone does, with this body sent as it is. */
function postSlotRequest(body: string, contentType = 'application/json') {
  return postToSlotPath(PHOTO_SLOTS_ROUTE, { 'Content-Type': contentType }, body);
}

/** Asks for a photo slot for this conversation. */
function askForSlot(conversationId: string = CONVERSATION_ID) {
  return postSlotRequest(JSON.stringify({ conversationId }));
}

/** Asks for a photo slot as a request Cloudflare passed on, from this address. */
function askForSlotThroughCloudflare(connectingAddress: string) {
  return postToSlotPath(
    PHOTO_SLOTS_ROUTE,
    { 'Content-Type': 'application/json', 'CF-Connecting-IP': connectingAddress },
    JSON.stringify({ conversationId: CONVERSATION_ID }),
  );
}

/** What a slot request answers with once it is granted. */
const openedSlotSchema = z.object({ uploadToken: z.string(), uploadPath: z.string(), expiresAt: z.string() });

describe('a photo slot', () => {
  beforeEach(() => {
    forgetPhotos();
  });

  afterEach(() => {
    // The store is the process's: a photo left here would be brought up by another file's requests.
    forgetPhotos();
  });

  it('is asked for at a path of its own, under the one Cloudflare Access lets the phone through', () => {
    expect(PHOTO_SLOTS_ROUTE).toBe('/api/photos/slots');
    expect(PHOTO_SLOTS_ROUTE.startsWith(`${PHOTO_UPLOAD_PATH}/`)).toBe(true);
  });

  it('is opened for a conversation live on Jarvis’s agent, and takes the photo at the path it gives', async () => {
    const response = await askForSlot();

    expect(response.status).toBe(201);
    const body = await readBody(response);
    expect(body.success).toBe(true);
    const slot = openedSlotSchema.parse(body.data);
    // The only upload path the phone will send to (`photo-upload.ts` in `mobile`).
    expect(slot.uploadPath).toMatch(/^\/api\/photos\/[A-Za-z0-9_-]{22}$/);
    expect(slot.uploadPath).toBe(`${PHOTO_UPLOAD_PATH}/${slot.uploadToken}`);
    expect(conversationsChecked).toEqual([CONVERSATION_ID]);

    const upload = await fetch(`${baseUrl}${slot.uploadPath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: JPEG,
      keepalive: false,
    });
    expect(upload.status).toBe(201);
    expect(findPhoto('photo1')?.data).toEqual(Buffer.from(JPEG));
  });

  it('says until when it is open', async () => {
    const before = Date.now();
    const slot = openedSlotSchema.parse((await readBody(await askForSlot())).data);
    const after = Date.now();

    const expiresAt = Date.parse(slot.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + UPLOAD_SLOT_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + UPLOAD_SLOT_MS);
  });

  describe('refused', () => {
    /**
     * Every slot there is room for, opened first: a slot opened now would let go of the oldest to
     * make room, so the oldest still being there afterwards is what says none was.
     */
    function fillEverySlot(): string[] {
      return Array.from({ length: MAX_OPEN_SLOTS }, () => openUploadSlot().uploadToken);
    }

    const refusals: { verdict: Exclude<ConversationVerdict, 'live'>; status: number; message: string }[] = [
      {
        verdict: 'malformed',
        status: 400,
        message: 'Send the id of the conversation the photo is for, as {"conversationId": "conv_…"}.',
      },
      { verdict: 'not-live', status: 403, message: 'That is not a conversation in progress with Jarvis.' },
      {
        verdict: 'too-many-checks',
        status: 429,
        message: 'Too many photo slots have been asked for in the last minute. Try again in a moment.',
      },
      { verdict: 'unverifiable', status: 502, message: 'ElevenLabs could not confirm the conversation just now.' },
      { verdict: 'switched-off', status: 503, message: 'Photo uploads are switched off on this server.' },
    ];

    for (const { verdict, status, message } of refusals) {
      it(`with ${status} when the check finds it ${verdict}, and no slot is opened`, async () => {
        const alreadyOpen = fillEverySlot();
        conversationVerdict = verdict;

        const response = await askForSlot();

        expect(response.status).toBe(status);
        // The same envelope as every other answer here, and nothing in it but the reason.
        expect(await readBody(response)).toEqual({ success: false, message });
        expect(claimUploadSlot(alreadyOpen[0] ?? '')).toBe(true);
      });
    }

    it('with 400, without asking the check, when the body names no conversation', async () => {
      // An empty JSON body is parsed as `{}`; a body that is not JSON at all is not parsed.
      const bodies = ['{}', '{"conversationId": 42}', '["conv_01jz8k3b4c5d6e7f"]', ''];

      for (const body of bodies) {
        expect(await readBody(await postSlotRequest(body))).toEqual({
          success: false,
          message: 'Send the id of the conversation the photo is for, as {"conversationId": "conv_…"}.',
        });
      }
      const plainText = await postSlotRequest(JSON.stringify({ conversationId: CONVERSATION_ID }), 'text/plain');
      expect(plainText.status).toBe(400);
      expect(conversationsChecked).toEqual([]);
    });

    it('with 400 too, in the same envelope, when the body is not JSON', async () => {
      const response = await postSlotRequest('conversationId=conv_01jz8k3b4c5d6e7f');

      expect(response.status).toBe(400);
      expect(await readBody(response)).toEqual({
        success: false,
        message: 'Send the id of the conversation the photo is for, as {"conversationId": "conv_…"}.',
      });
      expect(forwardedError).toBeUndefined();
      expect(conversationsChecked).toEqual([]);
    });

    it('without reading more than a kilobyte of what a stranger sends', async () => {
      const response = await postSlotRequest(
        JSON.stringify({ conversationId: CONVERSATION_ID, padding: 'x'.repeat(2048) }),
      );

      // Refused by the parser's limit — the id in it is never looked at — and answered as a body that
      // names no conversation, rather than by the server's error handler.
      expect(response.status).toBe(400);
      expect(forwardedError).toBeUndefined();
      expect(conversationsChecked).toEqual([]);
    });

    it('without reading more than a kilobyte either at the same path spelled in capitals', async () => {
      // Express routes these to the slot endpoint all the same. Had the server's own parser read the
      // body first, the route's limit would never have applied, and the id would have been checked.
      const body = JSON.stringify({ conversationId: CONVERSATION_ID, padding: 'x'.repeat(2048) });

      for (const path of ['/API/PHOTOS/SLOTS', '/Api/Photos/Slots']) {
        const response = await postToSlotPath(path, { 'Content-Type': 'application/json' }, body);

        expect(response.status).toBe(400);
        expect(await readBody(response)).toEqual({
          success: false,
          message: 'Send the id of the conversation the photo is for, as {"conversationId": "conv_…"}.',
        });
      }
      expect(forwardedError).toBeUndefined();
      expect(conversationsChecked).toEqual([]);
    });
  });

  describe('counted against whoever asks', () => {
    it('as the address Cloudflare says the request came from', async () => {
      expect((await askForSlotThroughCloudflare('198.51.100.23')).status).toBe(201);

      expect(sourcesAsking).toEqual(['198.51.100.23']);
    });

    it('as the address the connection came from, when the request did not come through Cloudflare', async () => {
      expect((await askForSlot()).status).toBe(201);

      // However the socket reports it: a dual-stack one says `::ffff:127.0.0.1`.
      expect(sourcesAsking).toEqual(['127.0.0.1']);
    });

    it('as the address the connection came from, when the header holds no address', async () => {
      await askForSlotThroughCloudflare('not an address');
      await askForSlotThroughCloudflare('198.51.100.23, 198.51.100.24');

      expect(sourcesAsking).toEqual(['127.0.0.1', '127.0.0.1']);
    });

    it('as one source for a whole IPv6 /64, however each address in it is written', async () => {
      const addresses = [
        '2001:db8:1:2::1',
        '2001:0DB8:0001:0002:ffff:ffff:ffff:fffe',
        '2001:db8:1:3::1',
        '2001:db8::5',
        '2001:db8:0:0:1::',
        '::ffff:192.0.2.1',
      ];
      for (const address of addresses) {
        await askForSlotThroughCloudflare(address);
      }

      expect(sourcesAsking).toEqual([
        '2001:db8:1:2::/64',
        '2001:db8:1:2::/64',
        '2001:db8:1:3::/64',
        '2001:db8:0:0::/64',
        '2001:db8:0:0::/64',
        // An IPv4 address written as IPv6 is the IPv4 address.
        '192.0.2.1',
      ]);
    });
  });

  it('can be asked for by the browser build, from its own origin', async () => {
    const preflight = await fetch(`${baseUrl}${PHOTO_SLOTS_ROUTE}`, { method: 'OPTIONS', keepalive: false });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('Content-Type');
    expect((await askForSlot()).headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('the photo upload', () => {
  beforeEach(() => {
    forgetPhotos();
  });

  afterEach(() => {
    // The store is the process's: a photo left here would be brought up by another file's requests.
    forgetPhotos();
  });

  it('is sent to the path a slot was opened with', () => {
    expect(PHOTO_UPLOAD_ROUTE).toBe('/api/photos/:uploadToken');
  });

  it('keeps a photo sent to a slot, with no key or credentials, and says what it is called now', async () => {
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

  it('is not the slot endpoint, whatever is sent to it', async () => {
    // A token is 22 characters, so `slots` names no slot however it is sent.
    expect((await putPhoto('slots')).status).toBe(404);
    expect(findPhoto(undefined)).toBeUndefined();
  });

  it('turns a stranger away before reading what they sent', async () => {
    // Larger than any photo is allowed to be. Read first, this would be refused as too large; that
    // it is refused as a slot that does not exist is what says nothing was read.
    const tooLarge = new Uint8Array(MAX_PHOTO_BYTES + 1);

    expect((await putPhoto('Q2hhbmdlIG1lIHBsZWFzZQ', tooLarge)).status).toBe(404);
    expect(forwardedError).toBeUndefined();
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

  it('refuses anything that is not an image, without reading it or spending the slot', async () => {
    const { uploadToken } = openUploadSlot();

    expect((await putPhoto(uploadToken, new TextEncoder().encode('{"a":1}'), 'application/json')).status).toBe(415);
    expect((await putPhotoWith(uploadToken, {}, new Uint8Array(MAX_PHOTO_BYTES + 1))).status).toBe(415);
    expect(forwardedError).toBeUndefined();
    expect((await putPhoto(uploadToken)).status).toBe(201);
  });

  it('refuses an empty body', async () => {
    const { uploadToken } = openUploadSlot();

    expect((await putPhoto(uploadToken, new Uint8Array(0))).status).toBe(415);
  });

  it('lets the browser build send from its own origin, asking for no header but the type', async () => {
    const preflight = await fetch(`${baseUrl}${PHOTO_UPLOAD_PATH}/Q2hhbmdlIG1lIHBsZWFzZQ`, {
      method: 'OPTIONS',
      keepalive: false,
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
    // No `Authorization`: there is no key to send.
    expect(preflight.headers.get('access-control-allow-headers')).toBe('Content-Type');

    const { uploadToken } = openUploadSlot();
    expect((await putPhoto(uploadToken)).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('keeps upload tokens out of the request log, and leaves the slot endpoint readable', () => {
    expect(withoutUploadToken('/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ')).toBe('/api/photos/…');
    expect(withoutUploadToken('/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ?x=1')).toBe('/api/photos/…?x=1');
    // A token may begin with the same letters; only the endpoint's own path is spared.
    expect(withoutUploadToken('/api/photos/slotsQ2hhbmdlIG1lIHBs')).toBe('/api/photos/…');
    expect(withoutUploadToken('/api/photos/slots')).toBe('/api/photos/slots');
    expect(withoutUploadToken('/api/photos/slots?x=1')).toBe('/api/photos/slots?x=1');
    expect(withoutUploadToken('/api/shopping-list')).toBe('/api/shopping-list');
    // Express routes a path in any case, so a token is taken out of one in any case too.
    expect(withoutUploadToken('/API/Photos/Q2hhbmdlIG1lIHBsZWFzZQ')).toBe('/API/Photos/…');
    expect(withoutUploadToken('/API/PHOTOS/SLOTS')).toBe('/API/PHOTOS/SLOTS');
  });
});

describe('the server’s JSON parser', () => {
  it('leaves the MCP endpoint and the photo routes to read their own bodies, however the path is spelled', () => {
    const readingTheirOwn = [
      MCP_PATH,
      '/API/MCP',
      `${MCP_PATH}/messages`,
      PHOTO_SLOTS_ROUTE,
      '/API/PHOTOS/SLOTS',
      '/Api/Photos/Q2hhbmdlIG1lIHBsZWFzZQ',
    ];

    for (const path of readingTheirOwn) {
      expect(readsItsOwnBody(path)).toBe(true);
    }
  });

  it('reads every other body', () => {
    for (const path of [
      '/api/shopping-list',
      '/API/SHOPPING-LIST',
      '/api/mcpx',
      PHOTO_UPLOAD_PATH,
      '/api/photosx/slots',
    ]) {
      expect(readsItsOwnBody(path)).toBe(false);
    }
  });
});
