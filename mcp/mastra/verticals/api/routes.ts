import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { extractErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { AnyWorkflow, AnyWorkflowResult } from '../../utils/workflows/workflow-factory.js';
import { shoppingListWorkflow } from '../shopping/workflows.js';
import {
  claimUploadSlot,
  KEEP_PHOTO_MS,
  keepPhoto,
  MAX_PHOTO_BYTES,
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_PATH,
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

/**
 * Where a photo is sent: `PHOTO_UPLOAD_PATH` and the token of the slot it was minted for.
 *
 * Spelled out rather than built from `PHOTO_UPLOAD_PATH`, so that it can be found as it is: the
 * phone's check of an upload URL (`camera-request.ts` in `hologram`) is pinned to this line.
 */
export const PHOTO_UPLOAD_ROUTE = '/api/photos/:uploadToken';

/** The one kind of body a photo may arrive as, from a `Content-Type` header, or `undefined`. */
function photoMediaType(contentType: string | undefined): PhotoMediaType | undefined {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return PHOTO_MEDIA_TYPES.find((allowed) => allowed === mediaType);
}

/**
 * Lets the browser build send a photo from the origin it is served from.
 *
 * Any origin, because the token in the path is the whole of the authority to upload: there are no
 * cookies or credentials for a wildcard to expose, and the phone's browser build is served from
 * GitHub Pages rather than from this server.
 */
function allowAnyOrigin(_request: Request, response: Response, next: NextFunction): void {
  response.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  });
  next();
}

/**
 * Turns an upload away before a byte of it is read, unless it is an image for a live slot.
 *
 * **The order is the protection.** This path has to be reachable without Cloudflare Access — the
 * phone holds no service token — so anyone can send to it. A body parser in front of this would read
 * a stranger's ten megabytes into memory before refusing them, and a few hundred of those at once
 * are the Pi's memory, and with it the process every other part of Jarvis runs in. Checked first,
 * a guessed token costs one map lookup, and a slot is read from once.
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
 * The request's path, with an upload token taken out, for logging.
 *
 * A token is a key to one slot for a few minutes, and a log is read by more people than that.
 */
export function withoutUploadToken(url: string): string {
  return url.replace(new RegExp(`^(${PHOTO_UPLOAD_PATH}/)[^/?#]+`), '$1…');
}

/**
 * Registers the endpoint sir's phone sends a photo to. See `vision/photos.ts` for the slot a photo
 * comes in through, and `preparePhotoUpload` for where its URL comes from.
 *
 * @returns The registered path, for logging
 */
export function registerPhotoUploadApi(router: Router): string {
  router.options(PHOTO_UPLOAD_ROUTE, allowAnyOrigin, (_request: Request, response: Response) => {
    response.sendStatus(204);
  });
  router.put(PHOTO_UPLOAD_ROUTE, allowAnyOrigin, claimSlotBeforeReading, readPhoto, keepUploadedPhoto);
  logger.info('[API] Registered photo upload endpoint', { method: 'PUT', path: PHOTO_UPLOAD_ROUTE });
  return PHOTO_UPLOAD_ROUTE;
}

/** An endpoint as it is announced when the server starts. */
export interface RegisteredApiRoute {
  method: 'POST' | 'PUT';
  path: string;
}

/**
 * Registers all API routes on the provided Express router.
 * The workflow routes are intended to be called from Home Assistant via REST calls; the photo
 * route by sir's phone, with a URL the voice agent had minted for it.
 *
 * @param router - The Express router to register routes on
 * @returns Every registered route, for logging purposes
 */
export function registerApiRoutes(router: Router): RegisteredApiRoute[] {
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

  // Photos sir shows Jarvis with his phone's camera
  registeredRoutes.push({ method: 'PUT', path: registerPhotoUploadApi(router) });

  // Add more workflow APIs here as needed:
  // registeredRoutes.push({ method: 'POST', path: registerWorkflowApi(router, { path: '/api/weather', workflow: weatherWorkflow }) });

  return registeredRoutes;
}
