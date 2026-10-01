import { z } from 'zod';
import { logger } from '../../utils/logger.js';

/**
 * Whether a conversation is one sir is having with Jarvis right now: the one check in front of a
 * photo slot.
 *
 * **Why a conversation, and not a key.** The slot endpoint (`POST /api/photos/slots` in
 * `api/routes.ts`) has to be reachable past Cloudflare Access — the phone holds no Access service
 * token — so anyone on the internet can ask it for a slot. The phone sends the id of the ElevenLabs
 * conversation it is in, and this asks ElevenLabs, with the server's own API key, whether that
 * conversation is in progress on Jarvis's agent; only then is a slot opened. Nothing has to be typed
 * into the phone for it, and nothing the phone holds is worth stealing. What it proves is modest, and
 * meant to be: that whoever asks knows the id of a conversation live on Jarvis's agent at this
 * moment. A conversation id is not a secret — it is in ElevenLabs' history, and the SDK sends it
 * unauthenticated to upload a file or leave feedback — so the upload itself is guarded by the slot's
 * token, 128 random bits handed straight back to whoever opened it and never through a third party.
 *
 * **A raw `fetch`, not the SDK.** `@elevenlabs/elevenlabs-js` parses the whole conversation strictly,
 * transcript and tool results included, and has thrown on shapes it did not expect
 * (elevenlabs-js issue #268); a conversation still in progress is the likeliest to have one. Only
 * the agent and the status matter here, so only they are read, and with a timeout of our own rather
 * than the SDK's four minutes and two retries — a photo slot is asked for while sir holds his phone
 * up. The body is the whole transcript, emails and calendar entries included, so it is **never
 * logged**: at most the upstream status, and the `detail.code` of a refusal.
 *
 * **Asked in three steps**, because nothing in ElevenLabs' documentation says how soon a call that has
 * just started can be looked up:
 * 1. `GET /v1/convai/conversations/{id}`. Live means on one of Jarvis's agents, and `initiated` or
 *    `in-progress`; `processing`, `done` and `failed` are a call that has ended.
 * 2. A `404` is asked again once, {@link NOT_FOUND_RETRY_MS} later.
 * 3. Still `404`, each agent's list of recent conversations that have not ended is searched for it.
 *
 * Anything else — a refused key, a rate limit, ElevenLabs down, a timeout, a body that is not what it
 * should be — is **unverifiable**, and the slot is refused: this fails closed.
 *
 * **Bounded, because the endpoint is public.** Each check costs up to four calls on Jarvis's
 * ElevenLabs key, so a verdict is remembered — live for {@link LIVE_VERDICT_KEPT_MS}, since the phone
 * asks again for each photo, and not live for {@link NOT_LIVE_VERDICT_KEPT_MS}, so that repeating an
 * id costs nothing upstream — and a check that does go upstream is counted twice: against whoever
 * asked, at most {@link MAX_CHECKS_PER_SOURCE_PER_MINUTE} a minute, and then against the whole
 * process, at most {@link MAX_CHECKS_PER_MINUTE}. The second is the bound on Jarvis's key: however
 * many ask, no more checks than that go upstream. Spending all of it turns away every photo sir sends
 * for as long as it lasts, and the first raises what that costs — five sources asking at once rather
 * than one — without ruling it out: a stranger with a few proxies, Tor's exit nodes or several
 * tunnels of their own has five sources. What stands behind it is the Cloudflare rate limiting rule
 * in front of the tunnel (see **MCP Server Access** in `mcp/AGENTS.md`), which turns away any one
 * address's flood before it reaches this server, and the process-wide limit itself, which keeps what
 * such a stranger can spend on the key to those checks. A malformed id never gets as far as
 * ElevenLabs at all.
 */

/** The ElevenLabs API key, which the phone vertical calls with too. */
const API_KEY_VARIABLE = 'HEY_JARVIS_ELEVENLABS_API_KEY';

/**
 * Jarvis's agents: the one sir's devices talk to, and the one the integration tests talk to.
 *
 * **Either counts, and neither takes precedence.** `initiatePhoneCall` prefers the test agent when
 * both are set, which is right for a call it places, and would be wrong here: a server with the test
 * agent's id configured would then turn away every photo from sir's phone, which talks to the other
 * one. At least one has to be set.
 */
const AGENT_ID_VARIABLES = ['HEY_JARVIS_ELEVENLABS_AGENT_ID', 'HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID'] as const;

/** Where ElevenLabs keeps its conversations. */
const CONVERSATIONS_URL = 'https://api.elevenlabs.io/v1/convai/conversations';

/**
 * What an ElevenLabs conversation id looks like, checked before anything is sent upstream.
 *
 * The phone sends only an id of this shape (the SDK's WebRTC placeholder, `room_<ms>`, is not one),
 * and the bounds keep a stranger's padding out of a URL this server builds.
 */
const CONVERSATION_ID = /^conv_[A-Za-z0-9]{8,64}$/;

/** The statuses of a conversation that has not ended. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['initiated', 'in-progress']);

/** The statuses a conversation has once it has ended, left out of the list that is searched. */
const ENDED_STATUSES = ['processing', 'done', 'failed'] as const;

/** How long one request to ElevenLabs may take before the check gives up on it. */
const UPSTREAM_TIMEOUT_MS = 5_000;

/** How long to wait before asking again about a conversation ElevenLabs does not know yet. */
export const NOT_FOUND_RETRY_MS = 1_500;

/**
 * How far back the list of conversations is searched, in seconds.
 *
 * The longest a call can last — `maxDurationSeconds`, 900, in `elevenlabs/src/assets/agent-config.json`
 * — and a minute's slack: a call that started before that has ended, whatever it says.
 */
export const LIST_LOOKBACK_SECONDS = 900 + 60;

/**
 * The most conversations one agent's list is searched for.
 *
 * Only calls that have not ended, from the last {@link LIST_LOOKBACK_SECONDS}, are listed; a household
 * does not have a hundred of those at once.
 */
const LIST_PAGE_SIZE = 100;

/**
 * How long a conversation found live is taken to be live without asking again.
 *
 * A minute: long enough that three photos in a row cost one check, short enough that a call that
 * has ended is not trusted for long — and a slot opened in that minute is still single-use and good
 * for five minutes only.
 */
export const LIVE_VERDICT_KEPT_MS = 60_000;

/**
 * How long a conversation found not live is taken to be not live without asking again.
 *
 * An id ElevenLabs does not know is the dearest to check — the lookup, its retry and a list per
 * agent — and the cheapest to send, so without this a stranger could spend four requests on
 * Jarvis's key by repeating one made-up id. A minute, like a live verdict. What it costs is a call
 * so new that none of the three steps found it: that phone is turned away for the rest of the minute
 * too, rather than asked about again at its next tap.
 */
export const NOT_LIVE_VERDICT_KEPT_MS = 60_000;

/**
 * The most checks sent to ElevenLabs in a minute on behalf of one source — an address, or an IPv6
 * network (see `whoIsAsking` in `api/routes.ts`).
 *
 * A household is one source, behind its router, and it needs about one check per conversation a
 * minute: the phone asks once per photo, and not even that while its conversation is remembered as
 * live. Six leaves room for two phones at once and a refusal retried, and means that a stranger who
 * wants the whole process's {@link MAX_CHECKS_PER_MINUTE} has to ask from five sources at once. That
 * raises the cost of turning sir's photos away; it does not stop someone who has five sources to ask
 * from, which is why the process-wide limit is a bound of its own.
 */
export const MAX_CHECKS_PER_SOURCE_PER_MINUTE = 6;

/**
 * The most checks sent to ElevenLabs in a minute, from the whole process.
 *
 * A check is up to four requests (the lookup, its retry, and a list per agent). Thirty a minute is
 * far more than a household sends photos, and far fewer than a stranger would need to make this
 * server a way of spending Jarvis's ElevenLabs quota. It bounds what is remembered too — verdicts,
 * and the sources that checks were counted against — since only a check can add either.
 */
export const MAX_CHECKS_PER_MINUTE = 30;

/** The window {@link MAX_CHECKS_PER_MINUTE} and {@link MAX_CHECKS_PER_SOURCE_PER_MINUTE} count over. */
const CHECK_WINDOW_MS = 60_000;

/**
 * What a check found.
 *
 * - `live`: in progress on one of Jarvis's agents — open the slot
 * - `not-live`: ended, on another agent, or unknown to ElevenLabs
 * - `malformed`: not an ElevenLabs conversation id at all; nothing was asked
 * - `too-many-checks`: the minute's checks are spent, the asker's own or the whole process's;
 *   nothing was asked
 * - `unverifiable`: ElevenLabs could not be asked, or did not answer in a way that could be read
 * - `switched-off`: this server has no ElevenLabs key or no agent to compare with
 */
export type ConversationVerdict =
  | 'live'
  | 'not-live'
  | 'malformed'
  | 'too-many-checks'
  | 'unverifiable'
  | 'switched-off';

/**
 * Asks whether a conversation is live on Jarvis's agent, on behalf of `source`: whoever is asking,
 * as the key their checks are counted under ({@link MAX_CHECKS_PER_SOURCE_PER_MINUTE}).
 */
export type LiveConversationCheck = (conversationId: string, source: string) => Promise<ConversationVerdict>;

/** What a check needs from outside itself, so a spec can hand it a fake ElevenLabs and a clock. */
export interface LiveConversationDependencies {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The time, in milliseconds. */
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: LiveConversationDependencies = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/** A conversation, as far as the check reads it. Everything else in the body is dropped unread. */
const conversationSchema = z.object({ agent_id: z.string(), status: z.string() });

/** A page of an agent's conversations, as far as the check reads it. */
const conversationListSchema = z.object({
  conversations: z.array(z.object({ conversation_id: z.string(), agent_id: z.string(), status: z.string() })),
});

/** An ElevenLabs refusal, for its code alone. */
const refusalSchema = z.object({ detail: z.object({ code: z.string() }) });

/** What the check is configured with: the key to ask with, and the agents a live call may be on. */
interface CheckConfiguration {
  apiKey: string;
  jarvisAgentIds: ReadonlySet<string>;
}

/** A variable's value without the whitespace a pasted secret tends to pick up, or `undefined`. */
function readVariable(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * The key and agents to check with, read from the environment on every call — or `undefined` when
 * either is missing, and no conversation could be confirmed.
 */
function readConfiguration(): CheckConfiguration | undefined {
  const apiKey = readVariable(API_KEY_VARIABLE);
  const jarvisAgentIds = new Set(
    AGENT_ID_VARIABLES.flatMap((name) => {
      const agentId = readVariable(name);
      return agentId ? [agentId] : [];
    }),
  );
  return apiKey && jarvisAgentIds.size > 0 ? { apiKey, jarvisAgentIds } : undefined;
}

/**
 * Why no photo slot can be opened, for the one line the MCP server logs at startup — or `undefined`
 * when slots can be. Names the variables that are missing, never a value.
 */
export function whyPhotoSlotsAreOff(): string | undefined {
  const missing = [
    ...(readVariable(API_KEY_VARIABLE) ? [] : [API_KEY_VARIABLE]),
    ...(AGENT_ID_VARIABLES.some((name) => readVariable(name)) ? [] : [AGENT_ID_VARIABLES.join(' or ')]),
  ];
  if (missing.length === 0) {
    return undefined;
  }
  return `Photo uploads are off: ${missing.join(', and ')} ${missing.length === 1 ? 'is' : 'are'} not set, so no conversation can be confirmed as live, and every request for a photo slot is answered 503.`;
}

/** Whether ElevenLabs' view of a conversation makes it a live one of Jarvis's. */
function isLiveOnJarvis(conversation: { agent_id: string; status: string }, jarvisAgentIds: ReadonlySet<string>) {
  return jarvisAgentIds.has(conversation.agent_id) && LIVE_STATUSES.has(conversation.status);
}

/** A response's body as JSON, or `undefined` when it is not JSON at all. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Logs that ElevenLabs could not confirm a conversation: the status, and the refusal's code if it
 * had one. Never the body, and never the conversation's id.
 */
async function logUnverifiable(response: Response, why: string): Promise<void> {
  const refusal = refusalSchema.safeParse(await readJson(response));
  logger.warn(`[Photos] ElevenLabs could not confirm a conversation: ${why}`, {
    status: response.status,
    code: refusal.success ? refusal.data.detail.code : undefined,
  });
}

/** Builds the list request for one agent's recent conversations that have not ended. */
function recentConversationsUrl(agentId: string, nowMilliseconds: number): string {
  const query = new URLSearchParams();
  query.append('agent_id', agentId);
  query.append('page_size', String(LIST_PAGE_SIZE));
  query.append('call_start_after_unix', String(Math.floor(nowMilliseconds / 1000) - LIST_LOOKBACK_SECONDS));
  for (const status of ENDED_STATUSES) {
    query.append('exclude_statuses', status);
  }
  return `${CONVERSATIONS_URL}?${query.toString()}`;
}

/** A verdict that is remembered, and the moment it stops being taken as true. */
interface RememberedVerdict {
  verdict: 'live' | 'not-live';
  until: number;
}

/** Lets go of the checks, oldest first, that have fallen out of the window by `at`. */
function forgetChecksBefore(checkedAt: number[], at: number): void {
  while (checkedAt.length > 0) {
    const oldest = checkedAt[0];
    if (oldest === undefined || at - oldest < CHECK_WINDOW_MS) {
      return;
    }
    checkedAt.shift();
  }
}

/**
 * Builds a check with its own remembered verdicts and its own counts of checks.
 *
 * The server uses one, {@link checkLiveConversation}; a spec builds its own with a fake ElevenLabs,
 * clock and sleep, so nothing it does is seen by another.
 */
export function createLiveConversationCheck(
  dependencies: Partial<LiveConversationDependencies> = {},
): LiveConversationCheck {
  const { fetch: fetchUpstream, now, sleep } = { ...DEFAULT_DEPENDENCIES, ...dependencies };

  /** What each conversation was last found to be, while that is still taken as true. */
  const rememberedVerdicts = new Map<string, RememberedVerdict>();
  /** When each check in the current window went upstream, oldest first. */
  const checkedAt: number[] = [];
  /**
   * The same, by the source each was asked on behalf of. A source is added only by a check that
   * went upstream, and dropped once its window is empty, so there are never more of them than
   * {@link MAX_CHECKS_PER_MINUTE}, however many a stranger asks from.
   */
  const checkedAtBySource = new Map<string, number[]>();

  /** Sends one request to ElevenLabs, or answers `undefined` when it could not be made or timed out. */
  async function askUpstream(url: string, apiKey: string): Promise<Response | undefined> {
    try {
      return await fetchUpstream(url, {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      // The name alone — `TimeoutError`, `TypeError` — since a message may carry the URL, and the
      // URL the conversation's id.
      logger.warn('[Photos] ElevenLabs could not be reached to confirm a conversation', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return undefined;
    }
  }

  /** Looks one conversation up by its id: its verdict, or `not-found` when ElevenLabs knows no such id. */
  async function lookUp(
    conversationId: string,
    { apiKey, jarvisAgentIds }: CheckConfiguration,
  ): Promise<'live' | 'not-live' | 'unverifiable' | 'not-found'> {
    const response = await askUpstream(`${CONVERSATIONS_URL}/${conversationId}`, apiKey);
    if (!response) {
      return 'unverifiable';
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return 'not-found';
    }
    if (response.status !== 200) {
      await logUnverifiable(response, 'the lookup was refused');
      return 'unverifiable';
    }

    const conversation = conversationSchema.safeParse(await readJson(response));
    if (!conversation.success) {
      logger.warn('[Photos] ElevenLabs described a conversation in a shape that could not be read', {
        status: response.status,
      });
      return 'unverifiable';
    }
    return isLiveOnJarvis(conversation.data, jarvisAgentIds) ? 'live' : 'not-live';
  }

  /** Searches one agent's recent conversations that have not ended for this one. */
  async function searchRecent(
    conversationId: string,
    agentId: string,
    { apiKey, jarvisAgentIds }: CheckConfiguration,
  ): Promise<'live' | 'not-live' | 'unverifiable'> {
    const response = await askUpstream(recentConversationsUrl(agentId, now()), apiKey);
    if (!response) {
      return 'unverifiable';
    }
    if (response.status !== 200) {
      await logUnverifiable(response, 'the list of conversations was refused');
      return 'unverifiable';
    }

    const page = conversationListSchema.safeParse(await readJson(response));
    if (!page.success) {
      logger.warn('[Photos] ElevenLabs listed conversations in a shape that could not be read', {
        status: response.status,
      });
      return 'unverifiable';
    }
    const found = page.data.conversations.some(
      (conversation) => conversation.conversation_id === conversationId && isLiveOnJarvis(conversation, jarvisAgentIds),
    );
    return found ? 'live' : 'not-live';
  }

  /** The three steps, as the module's own documentation describes them. */
  async function askElevenLabs(conversationId: string, configuration: CheckConfiguration) {
    const first = await lookUp(conversationId, configuration);
    if (first !== 'not-found') {
      return first;
    }

    // A call that has only just started may not be something ElevenLabs can look up yet.
    await sleep(NOT_FOUND_RETRY_MS);
    const second = await lookUp(conversationId, configuration);
    if (second !== 'not-found') {
      return second;
    }

    // Found in any agent's list is live. Otherwise, a list that could not be read leaves it
    // unverifiable rather than not live: that list may have been the one it was in.
    const verdicts = await Promise.all(
      [...configuration.jarvisAgentIds].map((agentId) => searchRecent(conversationId, agentId, configuration)),
    );
    if (verdicts.includes('live')) {
      return 'live';
    }
    return verdicts.includes('unverifiable') ? 'unverifiable' : 'not-live';
  }

  /** Lets go of verdicts and counted checks that have outlived their time. */
  function prune(at: number): void {
    for (const [conversationId, remembered] of rememberedVerdicts) {
      if (remembered.until <= at) {
        rememberedVerdicts.delete(conversationId);
      }
    }
    forgetChecksBefore(checkedAt, at);
    for (const [source, checkedAtFromSource] of checkedAtBySource) {
      forgetChecksBefore(checkedAtFromSource, at);
      if (checkedAtFromSource.length === 0) {
        checkedAtBySource.delete(source);
      }
    }
  }

  return async (conversationId, source) => {
    if (!CONVERSATION_ID.test(conversationId)) {
      return 'malformed';
    }

    const configuration = readConfiguration();
    if (!configuration) {
      return 'switched-off';
    }

    const at = now();
    prune(at);
    const remembered = rememberedVerdicts.get(conversationId);
    if (remembered) {
      return remembered.verdict;
    }

    // The source's limit first, and a check refused by it is not counted against the process: a
    // stranger asking over and over spends only their own minute. Not logged: the request log
    // already has every refusal's status, and a flood of them is exactly when a line apiece would
    // bury everything else.
    const checkedAtFromSource = checkedAtBySource.get(source) ?? [];
    if (checkedAtFromSource.length >= MAX_CHECKS_PER_SOURCE_PER_MINUTE || checkedAt.length >= MAX_CHECKS_PER_MINUTE) {
      return 'too-many-checks';
    }
    checkedAt.push(at);
    checkedAtFromSource.push(at);
    checkedAtBySource.set(source, checkedAtFromSource);

    const verdict = await askElevenLabs(conversationId, configuration);
    // An unverifiable verdict is never remembered: ElevenLabs said nothing about the conversation,
    // and the next photo should get to ask again.
    if (verdict === 'live') {
      rememberedVerdicts.set(conversationId, { verdict, until: now() + LIVE_VERDICT_KEPT_MS });
    } else if (verdict === 'not-live') {
      rememberedVerdicts.set(conversationId, { verdict, until: now() + NOT_LIVE_VERDICT_KEPT_MS });
    }
    return verdict;
  };
}

/** The check the slot endpoint asks, one for the whole process. */
export const checkLiveConversation: LiveConversationCheck = createLiveConversationCheck();
