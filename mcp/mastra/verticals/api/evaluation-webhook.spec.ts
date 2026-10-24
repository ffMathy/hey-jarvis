import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { Server } from 'http';
import { FAILED_CONVERSATION_PAYLOAD } from '../coding/evaluation-failures.fixture.js';
import {
  EVALUATION_WEBHOOK_ROUTE,
  EvaluationFixLedger,
  isFresh,
  isSignedWith,
  MAX_FIX_SESSIONS_PER_WINDOW,
  parseSignatureHeader,
  registerEvaluationWebhookApi,
  WEBHOOK_SECRET_VARIABLE,
  whyEvaluationFixesAreOff,
} from './evaluation-webhook.js';
import { readsItsOwnBody } from './routes.js';

const SECRET = 'wsec_test-secret';
const NOW = 1_739_537_400_000;
const AGENT_ID_VARIABLE = 'HEY_JARVIS_ELEVENLABS_AGENT_ID';

/** Signs a body as ElevenLabs does: `t=<seconds>,v0=<HMAC-SHA256 of "<seconds>.<body>">`. */
function sign(body: string, secret = SECRET, seconds = Math.floor(NOW / 1000)): string {
  return `t=${seconds},v0=${createHmac('sha256', secret).update(`${seconds}.${body}`).digest('hex')}`;
}

let server: Server;
let baseUrl: string;
const startedFixes: Array<{ title: string; request: string }> = [];
let originalSecret: string | undefined;
let originalAgentId: string | undefined;

/** Builds a server the way the MCP server does: JSON parsing everywhere but the routes that read their own body. */
async function startServer(): Promise<void> {
  const app = express();
  const parseJson = express.json();
  app.use((request, response, next) => (readsItsOwnBody(request.path) ? next() : parseJson(request, response, next)));
  const router = express.Router();
  registerEvaluationWebhookApi(router, {
    startEvaluationFix: async (fix) => {
      startedFixes.push(fix);
    },
    now: () => NOW,
  });
  app.use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to be listening on a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

/** Posts a payload, signed unless a signature is given. */
async function postWebhook(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return fetch(`${baseUrl}${EVALUATION_WEBHOOK_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ElevenLabs-Signature': signature ?? sign(body) },
    body,
  });
}

/** The failed conversation, under another id, so the ledger takes each test's afresh. */
function failedConversation(conversationId: string) {
  return {
    ...FAILED_CONVERSATION_PAYLOAD,
    data: { ...FAILED_CONVERSATION_PAYLOAD.data, conversation_id: conversationId },
  };
}

beforeAll(async () => {
  originalSecret = process.env[WEBHOOK_SECRET_VARIABLE];
  originalAgentId = process.env[AGENT_ID_VARIABLE];
  await startServer();
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  process.env[WEBHOOK_SECRET_VARIABLE] = SECRET;
  process.env[AGENT_ID_VARIABLE] = 'agent_jarvis';
  startedFixes.length = 0;
});

afterEach(() => {
  for (const [name, value] of [
    [WEBHOOK_SECRET_VARIABLE, originalSecret],
    [AGENT_ID_VARIABLE, originalAgentId],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('the post-call webhook', () => {
  it('starts a fix for a conversation that failed its evaluation, with the transcript and the reason', async () => {
    const response = await postWebhook(failedConversation('conv_one'));

    expect(response.status).toBe(202);
    expect(startedFixes).toHaveLength(1);
    expect(startedFixes[0]?.title).toBe('Fix the failed evaluation of conversation conv_one');
    expect(startedFixes[0]?.request).toContain('the_user_was_satisfied: The agent claimed the lights were off');
    expect(startedFixes[0]?.request).toContain('[00:03] user: Turn off the kitchen lights.');
  });

  it('starts nothing twice for a conversation ElevenLabs sends again', async () => {
    await postWebhook(failedConversation('conv_twice'));
    const again = await postWebhook(failedConversation('conv_twice'));

    expect(again.status).toBe(200);
    expect(startedFixes).toHaveLength(1);
  });

  it('starts nothing for a conversation that passed', async () => {
    const passed = failedConversation('conv_passed');
    const response = await postWebhook({
      ...passed,
      data: {
        ...passed.data,
        analysis: {
          evaluation_criteria_results: {
            the_user_was_satisfied: { criteria_id: 'the_user_was_satisfied', result: 'success', rationale: 'Fine.' },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(startedFixes).toEqual([]);
  });

  it("starts nothing for another agent's conversation, such as the test agent's", async () => {
    const other = failedConversation('conv_test_agent');
    const response = await postWebhook({ ...other, data: { ...other.data, agent_id: 'agent_test' } });

    expect(response.status).toBe(200);
    expect(startedFixes).toEqual([]);
  });

  it('acknowledges every other kind of webhook, so ElevenLabs does not disable it', async () => {
    const response = await postWebhook({ type: 'post_call_audio', data: { conversation_id: 'conv', full_audio: '' } });

    expect(response.status).toBe(200);
    expect(startedFixes).toEqual([]);
  });

  it('refuses a body whose signature does not match', async () => {
    const body = JSON.stringify(failedConversation('conv_forged'));
    const response = await postWebhook(failedConversation('conv_forged'), sign(body, 'someone-elses-secret'));

    expect(response.status).toBe(401);
    expect(startedFixes).toEqual([]);
  });

  it('refuses a request with no signature at all', async () => {
    const response = await fetch(`${baseUrl}${EVALUATION_WEBHOOK_ROUTE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failedConversation('conv_unsigned')),
    });

    expect(response.status).toBe(401);
    expect(startedFixes).toEqual([]);
  });

  it('refuses a signature older than half an hour, so a captured request cannot be replayed', async () => {
    const body = JSON.stringify(failedConversation('conv_replayed'));
    const response = await postWebhook(
      failedConversation('conv_replayed'),
      sign(body, SECRET, Math.floor(NOW / 1000) - 31 * 60),
    );

    expect(response.status).toBe(401);
  });

  it('answers 503 when the server has no secret to check with', async () => {
    delete process.env[WEBHOOK_SECRET_VARIABLE];
    const response = await postWebhook(failedConversation('conv_no_secret'));

    expect(response.status).toBe(503);
    expect(startedFixes).toEqual([]);
  });
});

describe('parseSignatureHeader', () => {
  it('reads the timestamp and the v0 signature', () => {
    const signature = 'a'.repeat(64);
    expect(parseSignatureHeader(`t=123,v0=${signature}`)).toEqual({ timestamp: '123', signature });
  });

  it('refuses a header in another scheme, or none', () => {
    expect(parseSignatureHeader(`t=123,v1=${'a'.repeat(64)}`)).toBeUndefined();
    expect(parseSignatureHeader('t=abc,v0=zz')).toBeUndefined();
    expect(parseSignatureHeader(undefined)).toBeUndefined();
  });
});

describe('isFresh and isSignedWith', () => {
  const body = '{"type":"post_call_transcription"}';
  const header = parseSignatureHeader(sign(body));
  if (!header) {
    throw new Error('Expected the signature to parse');
  }

  it('accepts the body it was signed over, and nothing else', () => {
    expect(isSignedWith(Buffer.from(body), header, SECRET)).toBe(true);
    expect(isSignedWith(Buffer.from(`${body} `), header, SECRET)).toBe(false);
  });

  it('accepts half an hour either side', () => {
    expect(isFresh(header, NOW + 29 * 60 * 1000)).toBe(true);
    expect(isFresh(header, NOW + 31 * 60 * 1000)).toBe(false);
  });
});

describe('EvaluationFixLedger', () => {
  it(`starts at most ${MAX_FIX_SESSIONS_PER_WINDOW} fixes a day`, () => {
    const ledger = new EvaluationFixLedger();
    const claims = Array.from({ length: MAX_FIX_SESSIONS_PER_WINDOW + 1 }, (_, index) =>
      ledger.claim(`conv_${index}`, NOW),
    );

    expect(claims.filter((claim) => claim === 'started')).toHaveLength(MAX_FIX_SESSIONS_PER_WINDOW);
    expect(claims.at(-1)).toBe('limited');
    expect(ledger.claim('conv_next_day', NOW + 24 * 60 * 60 * 1000)).toBe('started');
  });
});

describe('whyEvaluationFixesAreOff', () => {
  it('names the missing variable, and says nothing once it is set', () => {
    delete process.env[WEBHOOK_SECRET_VARIABLE];
    expect(whyEvaluationFixesAreOff()).toContain(WEBHOOK_SECRET_VARIABLE);

    process.env[WEBHOOK_SECRET_VARIABLE] = SECRET;
    expect(whyEvaluationFixesAreOff()).toBeUndefined();
  });
});

describe('readsItsOwnBody', () => {
  it('leaves the webhook body to the route, however the path is spelled', () => {
    expect(readsItsOwnBody(EVALUATION_WEBHOOK_ROUTE)).toBe(true);
    expect(readsItsOwnBody(EVALUATION_WEBHOOK_ROUTE.toUpperCase())).toBe(true);
    expect(readsItsOwnBody(`${EVALUATION_WEBHOOK_ROUTE}/`)).toBe(true);
    expect(readsItsOwnBody('/api/elevenlabs/other')).toBe(false);
  });
});
