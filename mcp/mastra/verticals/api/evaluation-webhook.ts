/**
 * The endpoint ElevenLabs calls when a conversation with Jarvis's voice agent has ended, with the
 * whole transcript and how the conversation scored against the agent's evaluation criteria. A
 * conversation that failed one has an unattended Claude Code session started on it to find the
 * cause and fix it: it asks the user nothing, and the server opens the pull request once the session
 * is done, as it does for every coding session.
 *
 * **ElevenLabs signs, the server checks.** The webhook is a workspace webhook with an HMAC secret
 * (`HEY_JARVIS_ELEVENLABS_WEBHOOK_SECRET`), and ElevenLabs cannot present a Cloudflare Access
 * service token, so the path is under {@link WEBHOOKS_PATH}, which bypasses Access, and the signature
 * is the only credential. Nothing past
 * the header is read until the header is well-formed and fresh, and nothing is acted on until the
 * body's signature matches.
 *
 * @see https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { logger } from '../../utils/logger.js';
import {
  describeEvaluationFix,
  describeEvaluationFixTitle,
  findFailedEvaluations,
  type PostCallTranscription,
  postCallTranscriptionSchema,
} from '../coding/evaluation-failures.js';
import { startImplementationSession } from '../coding/tools.js';

/**
 * Where every webhook is served: the one prefix a single Cloudflare Access *Bypass* application covers
 * (`<hostname>/webhooks/*`). A webhook's sender cannot present an Access service token, so each one
 * guards itself, with its sender's signature, and reads its own body to check it
 * (`readsItsOwnBody` in `routes.ts`).
 */
export const WEBHOOKS_PATH = '/webhooks';

/**
 * Where ElevenLabs posts a finished conversation. Spelled out rather than built from
 * {@link WEBHOOKS_PATH}, so that it can be found as it is: it is the URL the ElevenLabs webhook is
 * created with.
 */
export const EVALUATION_WEBHOOK_ROUTE = '/webhooks/elevenlabs/post-call';

/** The variable holding the HMAC secret ElevenLabs shows when the webhook is created. */
export const WEBHOOK_SECRET_VARIABLE = 'HEY_JARVIS_ELEVENLABS_WEBHOOK_SECRET';

/** The variable naming the agent whose conversations are fixed: the production agent, never the test agent. */
const AGENT_ID_VARIABLE = 'HEY_JARVIS_ELEVENLABS_AGENT_ID';

/** How old a signature may be, as ElevenLabs' own SDK allows: thirty minutes. */
const SIGNATURE_TOLERANCE_MS = 30 * 60 * 1000;

/** The largest body read. A long call with its tool results runs to a few hundred kilobytes. */
const MAX_PAYLOAD_SIZE = '4mb';

/**
 * How many fix sessions may start in {@link FIX_SESSION_WINDOW_MS}. A change that breaks the agent
 * fails every conversation after it, and one session per call would be a session per call.
 */
export const MAX_FIX_SESSIONS_PER_WINDOW = 5;
const FIX_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many conversation ids are remembered, so a redelivered webhook starts nothing twice. */
const REMEMBERED_CONVERSATIONS = 500;

/** Starts the session that fixes a conversation's failed evaluation. */
export type StartEvaluationFix = (fix: { title: string; request: string }) => Promise<void>;

/** What the endpoint needs from outside itself, so a spec can stand in for it. */
export interface EvaluationWebhookDependencies {
  startEvaluationFix?: StartEvaluationFix;
  now?: () => number;
}

/**
 * Starts the fix as an unattended session on Jarvis's own repository: nobody asked for it, so nobody
 * is asked anything about it.
 */
const startUnattendedFix: StartEvaluationFix = async ({ title, request }) => {
  const started = await startImplementationSession({ request, title, unattended: true });
  if (!started.success) {
    throw new Error(started.message);
  }
};

/** A variable's value without the whitespace a pasted secret tends to pick up, or `undefined`. */
function readVariable(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * Why failed evaluations will not be fixed, for the one line the MCP server logs at startup — or
 * `undefined` when they will be. Names the variable, never a value.
 */
export function whyEvaluationFixesAreOff(): string | undefined {
  if (readVariable(WEBHOOK_SECRET_VARIABLE)) {
    return undefined;
  }
  return `Failed ElevenLabs evaluations are not fixed: ${WEBHOOK_SECRET_VARIABLE} is not set, so no post-call webhook can be verified, and every one is answered 503.`;
}

/** The parts of an `ElevenLabs-Signature` header: `t=<unix seconds>,v0=<hex HMAC>`. */
interface SignatureHeader {
  timestamp: string;
  signature: string;
}

/** Reads the signature header, or `undefined` when it is missing or not in the `v0` scheme. */
export function parseSignatureHeader(header: string | undefined): SignatureHeader | undefined {
  const parts = (header ?? '').split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signature = parts.find((part) => part.startsWith('v0='))?.slice(3);
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return undefined;
  }
  return { timestamp, signature };
}

/** Whether a signature was made within {@link SIGNATURE_TOLERANCE_MS} of `now`, either side. */
export function isFresh({ timestamp }: SignatureHeader, now: number): boolean {
  return Math.abs(now - Number(timestamp) * 1000) <= SIGNATURE_TOLERANCE_MS;
}

/**
 * Whether the body was signed with the secret: HMAC-SHA256 of `<timestamp>.<body>`, as ElevenLabs
 * signs it. Compared in constant time.
 */
export function isSignedWith(rawBody: Buffer, { timestamp, signature }: SignatureHeader, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Remembers which conversations have had a session started, and how many sessions have started
 * lately, so that neither a redelivery nor a run of failures starts more than it should.
 */
export class EvaluationFixLedger {
  private readonly handledConversations = new Set<string>();
  private readonly startedAt: number[] = [];

  /**
   * Claims a conversation for a fix: `started` when its session may start, `duplicate` when one was
   * already started for it, or `limited` when the window's sessions are spent.
   */
  claim(conversationId: string, now: number): 'started' | 'duplicate' | 'limited' {
    if (this.handledConversations.has(conversationId)) {
      return 'duplicate';
    }
    while (this.startedAt.length > 0 && now - (this.startedAt[0] ?? now) >= FIX_SESSION_WINDOW_MS) {
      this.startedAt.shift();
    }
    if (this.startedAt.length >= MAX_FIX_SESSIONS_PER_WINDOW) {
      return 'limited';
    }

    this.startedAt.push(now);
    this.handledConversations.add(conversationId);
    if (this.handledConversations.size > REMEMBERED_CONVERSATIONS) {
      const oldest = this.handledConversations.values().next().value;
      if (oldest !== undefined) {
        this.handledConversations.delete(oldest);
      }
    }
    return 'started';
  }
}

/** Answers in the JSON envelope every route here uses. */
function answer(response: Response, status: number, message: string): void {
  response.status(status).json({ success: status < 300, message });
}

/**
 * Turns a request away before its body is read, unless the server has a secret to check it with
 * and the request carries a fresh signature for it.
 */
function checkHeaderBeforeReading(now: () => number) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!readVariable(WEBHOOK_SECRET_VARIABLE)) {
      answer(response, 503, 'Post-call webhooks are switched off on this server.');
      return;
    }
    const header = parseSignatureHeader(request.get('ElevenLabs-Signature'));
    if (!header || !isFresh(header, now())) {
      answer(response, 401, 'The request is not signed by ElevenLabs.');
      return;
    }
    next();
  };
}

/** Reads the body as it was sent, since the signature is over its bytes. */
const readRawBody = express.raw({ type: () => true, limit: MAX_PAYLOAD_SIZE });

/** Reads a body the signature matched, or `undefined` when it is not JSON. */
function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Verifies the body, and starts a fix for a conversation that failed its evaluation. */
function handlePostCallWebhook(ledger: EvaluationFixLedger, startEvaluationFix: StartEvaluationFix, now: () => number) {
  return (request: Request, response: Response): void => {
    const secret = readVariable(WEBHOOK_SECRET_VARIABLE);
    const header = parseSignatureHeader(request.get('ElevenLabs-Signature'));
    // Express 5 leaves `body` undefined when no parser ran, rather than an empty object.
    const body: unknown = request.body;
    if (!secret || !header || !Buffer.isBuffer(body) || !isSignedWith(body, header, secret)) {
      answer(response, 401, 'The request is not signed by ElevenLabs.');
      return;
    }

    // Every other kind of webhook — audio, a failed call initiation — is acknowledged and left alone:
    // ElevenLabs disables a webhook that keeps failing.
    const payload = postCallTranscriptionSchema.safeParse(parseJson(body));
    if (!payload.success) {
      answer(response, 200, 'Not a post-call transcription; nothing to do.');
      return;
    }

    const productionAgentId = readVariable(AGENT_ID_VARIABLE);
    if (productionAgentId && payload.data.data.agent_id !== productionAgentId) {
      answer(response, 200, "Not Jarvis's agent; nothing to do.");
      return;
    }

    const failures = findFailedEvaluations(payload.data);
    if (failures.length === 0) {
      answer(response, 200, 'The conversation passed its evaluation.');
      return;
    }

    const conversationId = payload.data.data.conversation_id;
    const claim = ledger.claim(conversationId, now());
    if (claim !== 'started') {
      logger.warn('[API] Failed evaluation not fixed', { conversationId, reason: claim });
      answer(
        response,
        200,
        claim === 'duplicate'
          ? 'A fix was already started for this conversation.'
          : `${MAX_FIX_SESSIONS_PER_WINDOW} fixes have been started in the last day; this one is not.`,
      );
      return;
    }

    logger.info('[API] Conversation failed its evaluation; starting a fix', {
      conversationId,
      criteria: failures.map((failure) => failure.criterionId),
    });
    // Answered before the session starts: starting one waits on the sandbox, and ElevenLabs does not.
    startFixInBackground(startEvaluationFix, payload.data, failures);
    answer(response, 202, 'The conversation failed its evaluation; a coding session is being started to fix it.');
  };
}

/** Starts the fix without holding the webhook's answer, and logs a fix that did not start. */
function startFixInBackground(
  startEvaluationFix: StartEvaluationFix,
  payload: PostCallTranscription,
  failures: ReturnType<typeof findFailedEvaluations>,
): void {
  const conversationId = payload.data.conversation_id;
  void startEvaluationFix({
    title: describeEvaluationFixTitle(payload),
    request: describeEvaluationFix(payload, failures),
  }).catch((error: unknown) => {
    logger.error('[API] The fix for a failed evaluation did not start', { conversationId, error });
  });
}

/**
 * Registers the endpoint ElevenLabs posts finished conversations to.
 *
 * Answers `202` when a fix is being started, `200` for anything authentic that needs none, `401`
 * for a request without a fresh, matching signature, and `503` when this server has no secret.
 *
 * @returns The registered path, for logging
 */
export function registerEvaluationWebhookApi(router: Router, dependencies: EvaluationWebhookDependencies = {}): string {
  const now = dependencies.now ?? Date.now;
  const ledger = new EvaluationFixLedger();
  router.post(
    EVALUATION_WEBHOOK_ROUTE,
    checkHeaderBeforeReading(now),
    readRawBody,
    handlePostCallWebhook(ledger, dependencies.startEvaluationFix ?? startUnattendedFix, now),
  );
  logger.info('[API] Registered ElevenLabs post-call webhook', { method: 'POST', path: EVALUATION_WEBHOOK_ROUTE });
  return EVALUATION_WEBHOOK_ROUTE;
}
