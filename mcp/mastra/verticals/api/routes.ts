import { isIP } from 'node:net';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { type ZodTypeAny, z } from 'zod';
import { extractErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { AnyWorkflow, AnyWorkflowResult } from '../../utils/workflows/workflow-factory.js';
import { shoppingListWorkflow } from '../shopping/workflows.js';
import {
  type ConversationVerdict,
  checkLiveConversation,
  claimUploadSlot,
  KEEP_PHOTO_MS,
  keepPhoto,
  type LiveConversationCheck,
  MAX_PHOTO_BYTES,
  openUploadSlot,
  PHOTO_MEDIA_TYPES,
  type PhotoMediaType,
} from '../vision/index.js';

/**
 * Standard API response structure for workflow endpoints.
 */
interface WorkflowApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

/**
 * Formats Zod validation errors into a human-readable string.
 */
function formatValidationErrors(zodError: {
  issues: Array<{ path?: Array<string | number | symbol>; message: string }>;
}): string {
  return zodError.issues.map((e) => `${e.path?.map(String).join('.') ?? ''}: ${e.message}`).join(', ');
}

/**
 * Extracts an error message from a workflow result, falling back to the status
 * when the result carries no detail at all.
 */
export function extractWorkflowError(result: AnyWorkflowResult): string {
  const error: unknown = 'error' in result ? result.error : undefined;
  return extractErrorMessage(error) ?? `Workflow failed with status ${result.status}`;
}

/**
 * Creates an Express request handler that validates input using the workflow's
 * input schema and executes the workflow.
 *
 * @param workflow - The Mastra workflow to expose as an API endpoint
 * @returns Express middleware function that handles the workflow execution
 *
 * @example
 * ```typescript
 * const handler = createWorkflowApiHandler(shoppingListWorkflow);
 * router.post('/api/shopping-list', handler);
 * ```
 */
export function createWorkflowApiHandler(
  workflow: AnyWorkflow,
): (req: Request, res: Response, next: NextFunction) => void {
  const workflowName = workflow.name ?? workflow.id;

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      try {
        const inputSchema = workflow.inputSchema;

        if (inputSchema) {
          const parseResult = (inputSchema as ZodTypeAny).safeParse(req.body);

          if (!parseResult.success) {
            const errorMessage = formatValidationErrors(parseResult.error);
            res.status(400).json({
              success: false,
              message: `Validation failed: ${errorMessage}`,
            } satisfies WorkflowApiResponse);
            return;
          }
        }

        logger.info('[API] Request received', { workflowName });

        const run = await workflow.createRun();
        const result = await run.start({
          inputData: req.body,
        });

        if (result.status !== 'success') {
          const errorMessage = extractWorkflowError(result);

          logger.error('[API] Workflow failed', {
            workflowName,
            error: errorMessage,
          });
          res.status(500).json({
            success: false,
            message: `Failed to execute ${workflowName}`,
            error: errorMessage,
          } satisfies WorkflowApiResponse);
          return;
        }

        logger.info('[API] Workflow completed successfully', { workflowName });

        res.json({
          success: true,
          message: `${workflowName} completed successfully`,
          data: result.result,
        } satisfies WorkflowApiResponse);
      } catch (error: unknown) {
        logger.error('[API] Unexpected error in endpoint', {
          workflowName,
          error,
        });
        next(error);
      }
    })();
  };
}

/**
 * Configuration for registering a workflow as an API endpoint.
 */
interface WorkflowApiConfig {
  /** The URL path for the API endpoint (e.g., '/api/shopping-list') */
  path: string;
  /** The workflow to expose at this endpoint */
  workflow: AnyWorkflow;
  /** Optional description for logging purposes */
  description?: string;
}

/**
 * Registers a workflow as a POST API endpoint on the provided router.
 *
 * @param router - The Express router to register the route on
 * @param config - Configuration for the workflow API endpoint
 * @returns The registered path for tracking purposes
 *
 * @example
 * ```typescript
 * const path = registerWorkflowApi(router, {
 *   path: '/api/shopping-list',
 *   workflow: shoppingListWorkflow,
 *   description: 'Add items to the shopping list',
 * });
 * ```
 */
export function registerWorkflowApi(router: Router, config: WorkflowApiConfig): string {
  const handler = createWorkflowApiHandler(config.workflow);
  router.post(config.path, handler);
  logger.info('[API] Registered workflow endpoint', {
    method: 'POST',
    path: config.path,
    workflow: config.workflow.name ?? config.workflow.id,
  });
  return config.path;
}

/** Where photos go: the slot endpoint and every upload are under this path. */
export const PHOTO_UPLOAD_PATH = '/api/photos';

/**
 * Where the MCP endpoint is served (`mcp-server.ts`). Declared here, beside the photo paths, because
 * {@link readsItsOwnBody} has to know it, and this module can be imported without starting a server.
 */
export const MCP_PATH = '/api/mcp';

/**
 * Whether the route at this path reads its own body, so that the MCP server's JSON parser must leave
 * the request alone: the MCP endpoint and its subpaths, which read the raw body, and everything under
 * {@link PHOTO_UPLOAD_PATH}, which is open to anyone — an upload is turned away before anything a
 * stranger sends is read (`claimSlotBeforeReading`), and a slot request reads its own body, a
 * kilobyte at most (`readSlotRequest`).
 *
 * **Compared in lower case**, because Express matches routes without regard to case:
 * `/API/PHOTOS/SLOTS` reaches the slot endpoint all the same, and a skip that missed it would let
 * the server's parser read a hundred kilobytes first — after which the route's own parser, finding
 * the body already read, would not apply its limit at all.
 */
export function readsItsOwnBody(path: string): boolean {
  const lowerCasePath = path.toLowerCase();
  return (
    lowerCasePath === MCP_PATH ||
    lowerCasePath.startsWith(`${MCP_PATH}/`) ||
    lowerCasePath.startsWith(`${PHOTO_UPLOAD_PATH}/`)
  );
}

/**
 * Where sir's phone asks for somewhere to send a photo, with the id of the conversation it is in.
 *
 * Under {@link PHOTO_UPLOAD_PATH} on purpose: that is the one path Cloudflare Access lets the phone
 * through without a service token (see "MCP Server Access" in `mcp/AGENTS.md`), and the one the MCP
 * server's JSON parser leaves alone. Spelled out rather than built, so that it can be found as it
 * is: the phone posts to this exact path.
 */
export const PHOTO_SLOTS_ROUTE = '/api/photos/slots';

/**
 * Where a photo is sent: {@link PHOTO_UPLOAD_PATH} and the token of the slot it was opened for.
 *
 * Spelled out rather than built from {@link PHOTO_UPLOAD_PATH}, so that it can be found as it is.
 * The phone only sends to an `uploadPath` that matches `^/api/photos/[A-Za-z0-9_-]{22}$`
 * (`photo-upload.ts` in `mobile`), appended to the server address in its own settings, so the path
 * and the token's shape (`openUploadSlot` in `vision/photos.ts`) must stay as they are. A token is
 * 22 characters, so it can never be `slots`.
 */
export const PHOTO_UPLOAD_ROUTE = '/api/photos/:uploadToken';

/** The one kind of body a photo may arrive as, from a `Content-Type` header, or `undefined`. */
function photoMediaType(contentType: string | undefined): PhotoMediaType | undefined {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return PHOTO_MEDIA_TYPES.find((allowed) => allowed === mediaType);
}

/**
 * Lets the browser build ask for a slot and send a photo from the origin it is served from.
 *
 * Any origin, because what lets a request through is written into it by the phone itself — the
 * conversation id in the slot request's body, the slot's token in the upload's path — rather than
 * anything a browser attaches on its own: there are no cookies for a wildcard to expose, and a page
 * on another origin that knows neither gets nothing. `Content-Type` has to be named, since a browser
 * sends `application/json` or `image/jpeg` across origins only when the preflight allows it; the
 * phone's browser build is served from GitHub Pages rather than from this server.
 */
function allowAnyOrigin(_request: Request, response: Response, next: NextFunction): void {
  response.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  });
  next();
}

/** Answers a browser's preflight, which asks only which methods and headers may follow. */
function answerPreflight(_request: Request, response: Response): void {
  response.sendStatus(204);
}

/** What the phone sends to ask for a slot. */
const slotRequestSchema = z.object({ conversationId: z.string() });

/** How many of an IPv6 address's leading groups name the network it is in: its /64. */
const IPV6_NETWORK_GROUPS = 4;

/**
 * The network an address counts as, for a limit per source: an IPv4 address is its own, and an IPv6
 * address is its /64 — the block a single connection is handed, which lets whoever holds one ask from
 * a new address every time. An IPv4 address written as IPv6 (`::ffff:192.0.2.1`, as a dual-stack
 * socket reports one) is the IPv4 address.
 */
function networkOf(address: string): string {
  const mappedIPv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mappedIPv4) {
    return mappedIPv4;
  }
  if (isIP(address) !== 6) {
    return address;
  }

  // Written out in full, without a zone (`%eth0`): `::` stands for however many groups of zeros are
  // missing, and an IPv4 address at the end for two groups.
  const [head = '', tail = ''] = address.replace(/%.*$/, '').split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groupsIn = (groups: string[]) => groups.reduce((count, group) => count + (group.includes('.') ? 2 : 1), 0);
  const zeros = Array.from({ length: 8 - groupsIn(headGroups) - groupsIn(tailGroups) }, () => '0');
  const network = [...headGroups, ...zeros, ...tailGroups]
    .slice(0, IPV6_NETWORK_GROUPS)
    .map((group) => Number.parseInt(group, 16).toString(16));
  return `${network.join(':')}::/64`;
}

/**
 * Who is asking for a slot, as the key their checks are counted under
 * (`MAX_CHECKS_PER_SOURCE_PER_MINUTE` in `vision/live-conversation.ts`).
 *
 * **`CF-Connecting-IP` when it holds an address.** Behind the Cloudflare tunnel every request arrives
 * from `cloudflared`, so the socket's own address is the same for everyone, and one stranger's limit
 * would be everyone's. Cloudflare sets this header on every request it passes to the tunnel, to the
 * address the request came from, replacing any value the client sent, and the tunnel is the only way
 * in from outside — so the header is trusted here, where it could not be if the port were open to the
 * internet. What can still write it is a client on the LAN, which can reach the port directly and is
 * not whom this limit is for; the process-wide limit bounds what it could do with it anyway.
 *
 * **The socket's address otherwise**: a request without the header did not come through the tunnel —
 * from the LAN, or a spec — and whoever opened the connection is who is asking. Not
 * `X-Forwarded-For`, which a client can fill with whatever it likes, and which Express reads only with
 * `trust proxy` set.
 */
function whoIsAsking(request: Request): string {
  const connectingAddress = request.get('CF-Connecting-IP')?.trim();
  const address = connectingAddress && isIP(connectingAddress) ? connectingAddress : request.ip;
  return networkOf(address ?? 'an unknown address');
}

/** How each way a slot can be refused is answered, by what the conversation check found. */
const SLOT_REFUSALS: Record<Exclude<ConversationVerdict, 'live'>, { status: number; message: string }> = {
  malformed: {
    status: 400,
    message: 'Send the id of the conversation the photo is for, as {"conversationId": "conv_…"}.',
  },
  'not-live': { status: 403, message: 'That is not a conversation in progress with Jarvis.' },
  'too-many-checks': {
    status: 429,
    message: 'Too many photo slots have been asked for in the last minute. Try again in a moment.',
  },
  unverifiable: { status: 502, message: 'ElevenLabs could not confirm the conversation just now.' },
  'switched-off': { status: 503, message: 'Photo uploads are switched off on this server.' },
};

/** Answers a slot request that was refused, in the JSON envelope every answer here uses. */
function refuseSlot(response: Response, verdict: Exclude<ConversationVerdict, 'live'>): void {
  const { status, message } = SLOT_REFUSALS[verdict];
  response.status(status).json({ success: false, message } satisfies WorkflowApiResponse);
}

/** Parses a slot request's body, and refuses one over a kilobyte without buffering it. */
const parseSlotRequest = express.json({ limit: '1kb' });

/**
 * Reads the slot request's body: JSON, and at most a kilobyte.
 *
 * Its own parser rather than the server's, which skips everything under {@link PHOTO_UPLOAD_PATH}
 * (see {@link readsItsOwnBody}): the request is open to anyone, and `{"conversationId": "conv_…"}`
 * is a few dozen bytes, so a stranger's hundred kilobytes are refused rather than read. A body the
 * parser refuses — too large, not JSON — is answered like any other that names no conversation, in
 * the envelope the phone reads, rather than by the server's error handler.
 */
function readSlotRequest(request: Request, response: Response, next: NextFunction): void {
  parseSlotRequest(request, response, (error?: unknown) => {
    if (error !== undefined) {
      refuseSlot(response, 'malformed');
      return;
    }
    next();
  });
}

/**
 * Opens a slot for one photo, once the conversation the phone named is confirmed live on Jarvis's
 * agent (see `vision/live-conversation.ts`).
 *
 * The slot's token goes straight back to the phone, which is what makes it enough on its own to
 * guard the upload: it never passes through ElevenLabs or anyone else. It is never logged, and
 * neither is the conversation it was opened for.
 */
function openSlotForLiveConversation(
  isLiveJarvisConversation: LiveConversationCheck,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    void (async (): Promise<void> => {
      try {
        const slotRequest = slotRequestSchema.safeParse(request.body);
        if (!slotRequest.success) {
          refuseSlot(response, 'malformed');
          return;
        }

        const verdict = await isLiveJarvisConversation(slotRequest.data.conversationId, whoIsAsking(request));
        if (verdict !== 'live') {
          refuseSlot(response, verdict);
          return;
        }

        const { uploadToken, expiresAt } = openUploadSlot();
        logger.info('[API] Photo slot opened', { expiresAt: new Date(expiresAt).toISOString() });
        response.status(201).json({
          success: true,
          message: 'Photo slot opened',
          data: {
            uploadToken,
            uploadPath: `${PHOTO_UPLOAD_PATH}/${uploadToken}`,
            expiresAt: new Date(expiresAt).toISOString(),
          },
        } satisfies WorkflowApiResponse);
      } catch (error: unknown) {
        next(error);
      }
    })();
  };
}

/**
 * Turns an upload away before a byte of it is read, unless it is an image for a live slot.
 *
 * **The order is the protection.** This path has to be reachable without Cloudflare Access — the
 * phone holds no Access service token — and it asks for no key, so anyone can send to it, and what
 * is sent is read only once it is known to be wanted. A body parser in front of this would read a
 * stranger's ten megabytes into memory before refusing them, and a few hundred of those at once are
 * the Pi's memory, and with it the process every other part of Jarvis runs in. Checked first, a
 * guessed token costs one map lookup, and a slot is read from once.
 */
function claimSlotBeforeReading(request: Request, response: Response, next: NextFunction): void {
  if (!photoMediaType(request.headers['content-type'])) {
    response.status(415).json({
      success: false,
      message: `Send the photo as one of ${PHOTO_MEDIA_TYPES.join(', ')}.`,
    } satisfies WorkflowApiResponse);
    return;
  }

  const { uploadToken } = request.params;
  if (typeof uploadToken !== 'string' || !claimUploadSlot(uploadToken)) {
    response.status(404).json({
      success: false,
      message: 'This upload link has expired or has been used already.',
    } satisfies WorkflowApiResponse);
    return;
  }

  next();
}

/** Reads the photo itself — only ever for a slot just claimed, and never more than a photo can be. */
const readPhoto = express.raw({ type: [...PHOTO_MEDIA_TYPES], limit: MAX_PHOTO_BYTES, inflate: false });

/** Keeps what was read, and says what it is called now. */
function keepUploadedPhoto(request: Request, response: Response): void {
  const mediaType = photoMediaType(request.headers['content-type']);
  // Express 5 leaves `body` undefined when no parser ran, rather than an empty object.
  const body: unknown = request.body;
  if (!mediaType || !Buffer.isBuffer(body) || body.length === 0) {
    response
      .status(415)
      .json({ success: false, message: 'There was no photo in the request.' } satisfies WorkflowApiResponse);
    return;
  }

  const photo = keepPhoto(body, mediaType);
  logger.info('[API] Photo received', { photoId: photo.photoId, bytes: body.length, mediaType });
  response.status(201).json({
    success: true,
    message: 'Photo received',
    data: { photoId: photo.photoId, expiresAt: new Date(photo.keptAt + KEEP_PHOTO_MS).toISOString() },
  } satisfies WorkflowApiResponse);
}

/**
 * An upload token where the request log would show one: under the photo path, and not `slots`. In
 * any case, as Express routes them (see {@link readsItsOwnBody}).
 */
const UPLOAD_TOKEN_IN_PATH = new RegExp(`^(${PHOTO_UPLOAD_PATH}/)(?!slots(?:[/?#]|$))[^/?#]+`, 'i');

/**
 * The request's path, with an upload token taken out, for logging.
 *
 * A token is the key to one slot for a few minutes — the only one the upload asks for — and a log
 * is read by more people than that. The slot endpoint's own path is left readable: it names no slot.
 */
export function withoutUploadToken(url: string): string {
  return url.replace(UPLOAD_TOKEN_IN_PATH, '$1…');
}

/**
 * Registers the endpoint sir's phone asks for a photo slot at. See `vision/live-conversation.ts` for
 * the check in front of it, and `vision/photos.ts` for the slot.
 *
 * Answers in the JSON envelope every route here uses: `201` with `{ uploadToken, uploadPath,
 * expiresAt }`, or `400` for a body that names no conversation id, `403` for a conversation that is
 * not live on Jarvis's agent, `429` once the minute's checks are spent — the asker's own
 * ({@link whoIsAsking}), or the whole process's — `502` when ElevenLabs could not confirm it, and
 * `503` when this server has no ElevenLabs key or agent to check with.
 *
 * @param isLiveJarvisConversation - The check to ask; the process's own unless a spec hands it a fake
 * @returns The registered path, for logging
 */
export function registerPhotoSlotApi(
  router: Router,
  isLiveJarvisConversation: LiveConversationCheck = checkLiveConversation,
): string {
  router.options(PHOTO_SLOTS_ROUTE, allowAnyOrigin, answerPreflight);
  router.post(
    PHOTO_SLOTS_ROUTE,
    allowAnyOrigin,
    readSlotRequest,
    openSlotForLiveConversation(isLiveJarvisConversation),
  );
  logger.info('[API] Registered photo slot endpoint', { method: 'POST', path: PHOTO_SLOTS_ROUTE });
  return PHOTO_SLOTS_ROUTE;
}

/**
 * Registers the endpoint sir's phone sends a photo to, at the path a slot was opened with. See
 * `vision/photos.ts` for the slot a photo comes in through, and {@link registerPhotoSlotApi} for
 * where the slot comes from.
 *
 * It asks for no key: the slot's token in the path is what lets a photo in (see
 * `vision/live-conversation.ts` for why that is enough).
 *
 * @returns The registered path, for logging
 */
export function registerPhotoUploadApi(router: Router): string {
  router.options(PHOTO_UPLOAD_ROUTE, allowAnyOrigin, answerPreflight);
  router.put(PHOTO_UPLOAD_ROUTE, allowAnyOrigin, claimSlotBeforeReading, readPhoto, keepUploadedPhoto);
  logger.info('[API] Registered photo upload endpoint', { method: 'PUT', path: PHOTO_UPLOAD_ROUTE });
  return PHOTO_UPLOAD_ROUTE;
}

/** An endpoint as it is announced when the server starts. */
export interface RegisteredApiRoute {
  method: 'POST' | 'PUT';
  path: string;
}

/** What the API routes need from outside themselves, so a spec can stand in for it. */
export interface ApiRouteDependencies {
  /** Asks whether the conversation a photo slot is for is live on Jarvis's agent. */
  isLiveJarvisConversation?: LiveConversationCheck;
}

/**
 * Registers all API routes on the provided Express router.
 * The workflow routes are intended to be called from Home Assistant via REST calls; the photo
 * routes by sir's phone — the slot request with the id of the conversation it is in, and the upload
 * with the path that request answered with.
 *
 * @param router - The Express router to register routes on
 * @param dependencies - Stand-ins for what the routes ask outside this process, for specs
 * @returns Every registered route, for logging purposes
 */
export function registerApiRoutes(router: Router, dependencies: ApiRouteDependencies = {}): RegisteredApiRoute[] {
  const registeredRoutes: RegisteredApiRoute[] = [];

  // Shopping List API - triggers shoppingListWorkflow
  registeredRoutes.push({
    method: 'POST',
    path: registerWorkflowApi(router, {
      path: '/api/shopping-list',
      workflow: shoppingListWorkflow,
      description: 'Add items to the shopping list using natural language',
    }),
  });

  // Photos sir sends Jarvis with his phone's camera button: a slot first, then the photo
  registeredRoutes.push({
    method: 'POST',
    path: registerPhotoSlotApi(router, dependencies.isLiveJarvisConversation),
  });
  registeredRoutes.push({ method: 'PUT', path: registerPhotoUploadApi(router) });

  // Add more workflow APIs here as needed:
  // registeredRoutes.push({ method: 'POST', path: registerWorkflowApi(router, { path: '/api/weather', workflow: weatherWorkflow }) });

  return registeredRoutes;
}
