/**
 * The check in front of a photo slot: whether a conversation is live on Jarvis's agent.
 *
 * Every test builds its own check on a fake ElevenLabs, a clock it moves by hand and a sleep that
 * only records how long it was asked to wait, so nothing here reaches the network, waits in earnest,
 * or shares a remembered verdict or a count of checks with another test.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { logger } from '../../utils/logger.js';
import {
  createLiveConversationCheck,
  LIST_LOOKBACK_SECONDS,
  LIVE_VERDICT_KEPT_MS,
  MAX_CHECKS_PER_MINUTE,
  NOT_FOUND_RETRY_MS,
  whyPhotoSlotsAreOff,
} from './live-conversation.js';

const API_KEY = 'an-elevenlabs-key-for-tests';
const JARVIS_AGENT = 'agent_01jarvis';
const TEST_AGENT = 'agent_01tests';
const OTHER_AGENT = 'agent_01someoneelse';
const CONVERSATION = 'conv_01jz8k3b4c5d6e7f';

/** Where the check asks about {@link CONVERSATION}. */
const LOOKUP_URL = `https://api.elevenlabs.io/v1/convai/conversations/${CONVERSATION}`;

/** Something only a transcript would hold, so a log line carrying the body would show it. */
const PRIVATE_WORDS = 'the alarm code is 4711';

const environmentKeys = [
  'HEY_JARVIS_ELEVENLABS_API_KEY',
  'HEY_JARVIS_ELEVENLABS_AGENT_ID',
  'HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.HEY_JARVIS_ELEVENLABS_API_KEY = API_KEY;
  process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID = JARVIS_AGENT;
  delete process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID;
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/** One answer ElevenLabs gives, built afresh each time, since a body can be read only once. */
type Reply = () => Response | Promise<Response>;

function json(body: unknown, status = 200): Reply {
  return () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A conversation as `GET /v1/convai/conversations/{id}` describes it, transcript and all. */
function conversation(agentId: string, status: string): Reply {
  return json({
    agent_id: agentId,
    status,
    conversation_id: CONVERSATION,
    metadata: { start_time_unix_secs: 1_800_000_000, call_duration_secs: 12 },
    transcript: [{ role: 'user', message: PRIVATE_WORDS, time_in_call_secs: 3 }],
    has_audio: true,
  });
}

/** An ElevenLabs refusal, in the shape its errors take. */
function refusal(status: number, code: string): Reply {
  return json({ detail: { type: 'error', code, message: 'Refused.', request_id: 'req_1' } }, status);
}

const NOT_FOUND = refusal(404, 'conversation_not_found');

/** A page of one agent's conversations, as `GET /v1/convai/conversations` lists them. */
function listing(...rows: { conversationId: string; agentId: string; status: string }[]): Reply {
  return json({
    conversations: rows.map((row) => ({
      conversation_id: row.conversationId,
      agent_id: row.agentId,
      status: row.status,
      start_time_unix_secs: 1_800_000_000,
      call_duration_secs: 12,
      message_count: 2,
    })),
    next_cursor: null,
    has_more: false,
  });
}

/** What the check sent upstream, as far as these tests read it. */
interface UpstreamRequest {
  url: URL;
  apiKey: string | null;
  signal: AbortSignal | null | undefined;
}

/**
 * A check on a fake ElevenLabs that answers lookups in turn — the last one again once they run out —
 * and each agent's list from `lists`.
 */
function checkAgainst(lookups: Reply[], lists: Record<string, Reply> = {}) {
  const requests: UpstreamRequest[] = [];
  const sleeps: number[] = [];
  const clock = { now: 1_800_000_000_000 };
  let lookupsAnswered = 0;

  const check = createLiveConversationCheck({
    fetch: async (url, init) => {
      const parsed = new URL(url);
      requests.push({ url: parsed, apiKey: new Headers(init.headers).get('xi-api-key'), signal: init.signal });

      if (parsed.pathname === '/v1/convai/conversations') {
        const reply = lists[parsed.searchParams.get('agent_id') ?? ''];
        if (!reply) {
          throw new Error(`No list was scripted for ${parsed.searchParams.get('agent_id')}`);
        }
        return reply();
      }

      const reply = lookups[Math.min(lookupsAnswered, lookups.length - 1)];
      lookupsAnswered += 1;
      if (!reply) {
        throw new Error('No lookup was scripted');
      }
      return reply();
    },
    now: () => clock.now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock.now += milliseconds;
    },
  });

  return { check, requests, sleeps, clock };
}

describe('a conversation live on Jarvis’s agent', () => {
  it('is live while it is in progress, asked with the key in a header and a deadline', async () => {
    const { check, requests } = checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('live');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.href).toBe(LOOKUP_URL);
    expect(requests[0]?.apiKey).toBe(API_KEY);
    // Never in the URL, which is what ends up in logs and error messages.
    expect(requests[0]?.url.href).not.toContain(API_KEY);
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('is live as soon as it has started', async () => {
    const { check } = checkAgainst([conversation(JARVIS_AGENT, 'initiated')]);

    expect(await check(CONVERSATION)).toBe('live');
  });

  it('reads only the agent and the status, so a transcript the SDK could not parse does not matter', async () => {
    // A tool result with a null `type` is what made the SDK's strict parse throw (elevenlabs-js #268).
    const { check } = checkAgainst([
      json({
        agent_id: JARVIS_AGENT,
        status: 'in-progress',
        transcript: [{ role: 'agent', tool_results: [{ type: null, result_value: 7 }] }],
      }),
    ]);

    expect(await check(CONVERSATION)).toBe('live');
  });
});

describe('a conversation that is not live', () => {
  it('is not live on another agent, even in progress', async () => {
    const { check } = checkAgainst([conversation(OTHER_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('not-live');
  });

  for (const status of ['processing', 'done', 'failed']) {
    it(`is not live once it has ended: ${status}`, async () => {
      const { check } = checkAgainst([conversation(JARVIS_AGENT, status)]);

      expect(await check(CONVERSATION)).toBe('not-live');
    });
  }
});

describe('a conversation ElevenLabs does not know yet', () => {
  it('is asked about again a moment later, and is live if it is found then', async () => {
    const { check, requests, sleeps } = checkAgainst([NOT_FOUND, conversation(JARVIS_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('live');

    expect(sleeps).toEqual([NOT_FOUND_RETRY_MS]);
    expect(requests.map((request) => request.url.href)).toEqual([LOOKUP_URL, LOOKUP_URL]);
  });

  it('is looked for among the agent’s calls that have not ended when it is still unknown', async () => {
    const { check, requests, clock } = checkAgainst([NOT_FOUND], {
      [JARVIS_AGENT]: listing({ conversationId: CONVERSATION, agentId: JARVIS_AGENT, status: 'in-progress' }),
    });

    expect(await check(CONVERSATION)).toBe('live');

    expect(requests).toHaveLength(3);
    const list = requests[2];
    expect(list?.apiKey).toBe(API_KEY);
    expect(list?.url.origin + (list?.url.pathname ?? '')).toBe('https://api.elevenlabs.io/v1/convai/conversations');
    // The clock has moved on by the retry's wait, and the window reaches back past the longest call.
    const since = Math.floor(clock.now / 1000) - LIST_LOOKBACK_SECONDS;
    expect(list?.url.search).toBe(
      `?agent_id=${JARVIS_AGENT}&page_size=100&call_start_after_unix=${since}` +
        '&exclude_statuses=processing&exclude_statuses=done&exclude_statuses=failed',
    );
  });

  it('is not live when no list has it live', async () => {
    const { check } = checkAgainst([NOT_FOUND], {
      [JARVIS_AGENT]: listing(
        { conversationId: 'conv_01someoneelsescall', agentId: JARVIS_AGENT, status: 'in-progress' },
        // Ended calls are asked to be left out, and one that is listed anyway still does not count.
        { conversationId: CONVERSATION, agentId: JARVIS_AGENT, status: 'done' },
      ),
    });

    expect(await check(CONVERSATION)).toBe('not-live');
  });

  it('is looked for on the test agent too, when one is configured', async () => {
    process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID = TEST_AGENT;
    const { check, requests } = checkAgainst([NOT_FOUND], {
      [JARVIS_AGENT]: listing(),
      [TEST_AGENT]: listing({ conversationId: CONVERSATION, agentId: TEST_AGENT, status: 'initiated' }),
    });

    expect(await check(CONVERSATION)).toBe('live');

    expect(requests.slice(2).map((request) => request.url.searchParams.get('agent_id'))).toEqual([
      JARVIS_AGENT,
      TEST_AGENT,
    ]);
  });

  it('is unverifiable, not dead, when a list could not be read: it may have been the one it was in', async () => {
    process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID = TEST_AGENT;
    const { check } = checkAgainst([NOT_FOUND], {
      [JARVIS_AGENT]: listing(),
      [TEST_AGENT]: refusal(500, 'internal_error'),
    });

    expect(await check(CONVERSATION)).toBe('unverifiable');
  });
});

describe('ElevenLabs not answering in a way that can be trusted', () => {
  const refusals: [string, Reply][] = [
    ['a key it does not accept', refusal(401, 'invalid_api_key')],
    ['a key without access to conversations', refusal(403, 'insufficient_permissions')],
    ['a rate limit', refusal(429, 'rate_limit_exceeded')],
    ['an error of its own', refusal(500, 'internal_error')],
    ['a gateway that could not reach it', () => new Response('<html>Bad gateway</html>', { status: 502 })],
  ];

  for (const [what, reply] of refusals) {
    it(`is unverifiable, and asked once, on ${what}`, async () => {
      const { check, requests } = checkAgainst([reply]);

      expect(await check(CONVERSATION)).toBe('unverifiable');
      expect(requests).toHaveLength(1);
    });
  }

  it('is unverifiable when ElevenLabs does not answer in time', async () => {
    const { check } = checkAgainst([
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    ]);

    expect(await check(CONVERSATION)).toBe('unverifiable');
  });

  it('is unverifiable when ElevenLabs cannot be reached at all', async () => {
    const { check } = checkAgainst([() => Promise.reject(new TypeError('fetch failed'))]);

    expect(await check(CONVERSATION)).toBe('unverifiable');
  });

  it('is unverifiable when the answer is not JSON, or not a conversation', async () => {
    expect(await checkAgainst([() => new Response('<html>Sign in</html>')]).check(CONVERSATION)).toBe('unverifiable');
    expect(await checkAgainst([json({ agent_id: JARVIS_AGENT })]).check(CONVERSATION)).toBe('unverifiable');
    expect(await checkAgainst([json(null)]).check(CONVERSATION)).toBe('unverifiable');
  });

  it('is unverifiable when a list is not a list', async () => {
    const { check } = checkAgainst([NOT_FOUND], { [JARVIS_AGENT]: json({ conversations: 'none' }) });

    expect(await check(CONVERSATION)).toBe('unverifiable');
  });

  it('logs the status and the refusal’s code, and never the body or the conversation', async () => {
    const warnings = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { check } = checkAgainst([
        json({ detail: { code: 'invalid_api_key', message: `${CONVERSATION}: ${PRIVATE_WORDS}` } }, 401),
      ]);
      await check(CONVERSATION);
      await checkAgainst([json({ transcript: PRIVATE_WORDS })]).check(CONVERSATION);

      expect(warnings.mock.calls).toContainEqual([expect.any(String), { status: 401, code: 'invalid_api_key' }]);
      const logged = JSON.stringify(warnings.mock.calls);
      expect(logged).not.toContain(PRIVATE_WORDS);
      expect(logged).not.toContain(CONVERSATION);
      expect(logged).not.toContain(API_KEY);
    } finally {
      warnings.mockRestore();
    }
  });
});

describe('an id that is not an ElevenLabs conversation id', () => {
  const notConversationIds = [
    '',
    'conv_',
    // Short, as a real one never is.
    'conv_1234567',
    `conv_${'a'.repeat(65)}`,
    // The SDK's placeholder until a WebRTC room is joined.
    'room_1759258000000',
    'conv_01jz8k3b/../../agents',
    'conv_01jz8k3b4c5d6e7f?page_size=100',
    ' conv_01jz8k3b4c5d6e7f',
  ];

  it('is refused without asking ElevenLabs anything', async () => {
    const { check, requests } = checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]);

    for (const conversationId of notConversationIds) {
      expect(await check(conversationId)).toBe('malformed');
    }
    expect(requests).toEqual([]);
  });
});

describe('a conversation found live', () => {
  it('is taken as live for a minute without asking ElevenLabs again', async () => {
    const { check, requests, clock } = checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('live');
    clock.now += LIVE_VERDICT_KEPT_MS - 1;
    expect(await check(CONVERSATION)).toBe('live');
    expect(requests).toHaveLength(1);

    clock.now += 1;
    expect(await check(CONVERSATION)).toBe('live');
    expect(requests).toHaveLength(2);
  });

  it('is asked about afresh when it was not live, since it may only not have been visible yet', async () => {
    const { check, requests } = checkAgainst([
      conversation(OTHER_AGENT, 'in-progress'),
      conversation(JARVIS_AGENT, 'in-progress'),
    ]);

    expect(await check(CONVERSATION)).toBe('not-live');
    expect(await check(CONVERSATION)).toBe('live');
    expect(requests).toHaveLength(2);
  });
});

describe('how often ElevenLabs is asked', () => {
  /** Distinct, well-formed ids, so that no check is answered from a remembered verdict. */
  function conversationNumber(index: number): string {
    return `conv_call${String(index).padStart(8, '0')}`;
  }

  it(`is at most ${MAX_CHECKS_PER_MINUTE} checks a minute, and the next is refused without asking`, async () => {
    const { check, requests, clock } = checkAgainst([conversation(OTHER_AGENT, 'in-progress')]);

    for (let index = 0; index < MAX_CHECKS_PER_MINUTE; index += 1) {
      expect(await check(conversationNumber(index))).toBe('not-live');
    }
    expect(await check(conversationNumber(MAX_CHECKS_PER_MINUTE))).toBe('too-many-checks');
    expect(requests).toHaveLength(MAX_CHECKS_PER_MINUTE);

    // A minute after the first, there is room again.
    clock.now += 60_000;
    expect(await check(conversationNumber(MAX_CHECKS_PER_MINUTE))).toBe('not-live');
  });

  it('does not count a conversation already found live against that', async () => {
    const { check, requests } = checkAgainst([
      conversation(JARVIS_AGENT, 'in-progress'),
      conversation(OTHER_AGENT, 'in-progress'),
    ]);

    expect(await check(CONVERSATION)).toBe('live');
    for (let index = 1; index < MAX_CHECKS_PER_MINUTE; index += 1) {
      await check(conversationNumber(index));
    }

    expect(await check(CONVERSATION)).toBe('live');
    expect(await check(conversationNumber(MAX_CHECKS_PER_MINUTE))).toBe('too-many-checks');
    expect(requests).toHaveLength(MAX_CHECKS_PER_MINUTE);
  });
});

describe('which of Jarvis’s agents count', () => {
  it('counts a conversation on the test agent, when that is the one configured', async () => {
    delete process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID = TEST_AGENT;

    expect(await checkAgainst([conversation(TEST_AGENT, 'in-progress')]).check(CONVERSATION)).toBe('live');
  });

  it('counts either when both are configured, and prefers neither', async () => {
    // `initiatePhoneCall` takes the test agent over sir's when both are set; here that would turn
    // away every photo from his phone.
    process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID = TEST_AGENT;

    expect(await checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]).check(CONVERSATION)).toBe('live');
    expect(await checkAgainst([conversation(TEST_AGENT, 'in-progress')]).check(CONVERSATION)).toBe('live');
    expect(await checkAgainst([conversation(OTHER_AGENT, 'in-progress')]).check(CONVERSATION)).toBe('not-live');
  });
});

describe('a server that cannot check', () => {
  it('is switched off without an ElevenLabs key, and asks nothing', async () => {
    delete process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    const { check, requests } = checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('switched-off');
    expect(requests).toEqual([]);
  });

  it('is switched off without an agent to compare with', async () => {
    delete process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    const { check, requests } = checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]);

    expect(await check(CONVERSATION)).toBe('switched-off');
    expect(requests).toEqual([]);
  });

  it('counts a variable of nothing but whitespace as unset', async () => {
    process.env.HEY_JARVIS_ELEVENLABS_API_KEY = '  \n';

    expect(await checkAgainst([conversation(JARVIS_AGENT, 'in-progress')]).check(CONVERSATION)).toBe('switched-off');
  });

  it('says nothing at startup when it can check', () => {
    expect(whyPhotoSlotsAreOff()).toBeUndefined();

    delete process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID = TEST_AGENT;
    expect(whyPhotoSlotsAreOff()).toBeUndefined();
  });

  it('says why at startup, naming what is missing and never a value', () => {
    delete process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    const withoutKey = whyPhotoSlotsAreOff();
    expect(withoutKey).toBe(
      'Photo uploads are off: HEY_JARVIS_ELEVENLABS_API_KEY is not set, so no conversation can be confirmed as live, and every request for a photo slot is answered 503.',
    );

    process.env.HEY_JARVIS_ELEVENLABS_API_KEY = API_KEY;
    delete process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    const withoutAgent = whyPhotoSlotsAreOff();
    expect(withoutAgent).toContain('HEY_JARVIS_ELEVENLABS_AGENT_ID or HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID is not set');
    expect(withoutAgent).not.toContain(API_KEY);

    delete process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    expect(whyPhotoSlotsAreOff()).toContain(
      'HEY_JARVIS_ELEVENLABS_API_KEY, and HEY_JARVIS_ELEVENLABS_AGENT_ID or HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID are not set',
    );
  });
});
