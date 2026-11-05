import { Knowledge, type KnowledgeScopeDeclarations, knowledgeMemoryScopes } from '@mastra/core/knowledge';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { getMastraStorageProvider } from '../storage/index.js';

/**
 * The key Jarvis's Knowledge is registered under on Mastra. Studio's Knowledge page and its
 * `/api/knowledge/<key>/…` routes address the instance by it.
 */
export const JARVIS_KNOWLEDGE_KEY = 'jarvis';

/** The household's scope type: Knowledge's tenant, which Memory's `resource:` scopes sit under. */
const HOUSEHOLD_SCOPE_PATTERN = 'household:$householdId';

/**
 * The one household Jarvis serves, as a Knowledge scope.
 *
 * Every agent attached to Knowledge holds it (see {@link householdKnowledgeOptions}), so what one
 * agent writes there is what every other one reads: the household's shared, durable facts.
 */
export const HOUSEHOLD_SCOPE = 'household:home';

/** The State Change Reactor's scope type, one per household. */
const SYNAPSE_SCOPE_PATTERN = 'synapse:$householdId';

/**
 * What the State Change Reactor watches the household for.
 *
 * Its pages are written by the synapse vertical's own code and nothing else: every agent holding the
 * household can read them, as a viewer, and none can edit them with its Knowledge tools. The
 * subscription tools change them, so a page always holds the record they wrote. See
 * `verticals/synapse/subscription-store.ts`.
 */
export const SYNAPSE_SCOPE = 'synapse:home';

/** The page under {@link SYNAPSE_SCOPE} each subscription is a child page of. */
export const SUBSCRIPTIONS_PAGE_KEY = 'subscriptions';

/** The household's conventions' scope type, one per household. */
const CONVENTIONS_SCOPE_PATTERN = 'conventions:$householdId';

/**
 * How the household likes things done, one page per vertical (see `knowledge/conventions.ts`).
 *
 * A page's body is the vertical's own conventions, kept in code and written to the page each time a
 * process starts. Agents holding the household are contributors here: they can add a note to a
 * page — a lasting convention the household has stated since — and cannot rewrite one.
 */
export const CONVENTIONS_SCOPE = 'conventions:home';

/**
 * The scopes Jarvis's Knowledge knows.
 *
 * Every scope an attached agent's run holds must match one of these, or the run is refused. Those
 * runs hold the household, and, through Memory, the `resource:` and `thread:` of the conversation,
 * so Memory's own declarations are here, under the household.
 */
function jarvisKnowledgeScopes(): KnowledgeScopeDeclarations {
  const memoryScopes = knowledgeMemoryScopes({ org: HOUSEHOLD_SCOPE_PATTERN });
  return {
    ...memoryScopes,
    [HOUSEHOLD_SCOPE_PATTERN]: {
      ...memoryScopes[HOUSEHOLD_SCOPE_PATTERN],
      displayLabel: 'Household',
      description: "The household Jarvis runs: facts, conventions and state every one of Jarvis's agents shares.",
    },
    [CONVENTIONS_SCOPE_PATTERN]: {
      displayLabel: 'Conventions',
      description:
        'How the household likes things done, one page per part of the house Jarvis runs. A page is the conventions Jarvis was built with; the notes on it are what the household has said since, newest last. Add a lasting convention as a note on its page; a page itself is never rewritten.',
      belongsTo: HOUSEHOLD_SCOPE_PATTERN,
      access: [{ principal: HOUSEHOLD_SCOPE_PATTERN, role: 'contributor' }],
    },
    [SYNAPSE_SCOPE_PATTERN]: {
      displayLabel: 'Synapse',
      description:
        'What Jarvis watches the house for: every subscription the State Change Reactor matches state changes against, and when each one fired. Read it here; change it only with the subscription tools.',
      belongsTo: HOUSEHOLD_SCOPE_PATTERN,
      access: [{ principal: HOUSEHOLD_SCOPE_PATTERN, role: 'viewer' }],
      pages: [
        {
          key: SUBSCRIPTIONS_PAGE_KEY,
          name: 'Subscriptions',
          description: 'Given/When/Then points of interest the household asked Jarvis to watch for, one page each.',
        },
      ],
    },
  };
}

/**
 * Builds Jarvis's Knowledge on `storage`: in production the Mastra instance's own store, the shared
 * SQLite file everything else lives in, whose LibSQL default implements Knowledge's storage domain; in
 * a test, an `InMemoryStore`.
 *
 * It is given the store rather than left to take it from Mastra on registration, so code that writes
 * to it never depends on whether `getMastra()` has run yet.
 *
 * Search is keyword-only: no vector store or embedder. Semantic search would embed every page and
 * note written, with the hosted embedder Memory uses, and this database has filled its disk with
 * embeddings once already (see `.claude/rules/mcp-state-change-notification-workflow.md`).
 */
export function createJarvisKnowledge(storage: MastraCompositeStore): Knowledge {
  return new Knowledge({
    id: JARVIS_KNOWLEDGE_KEY,
    name: 'Jarvis',
    description: "What Jarvis knows about the household he runs, shared by all of Jarvis's agents.",
    scopes: jarvisKnowledgeScopes(),
    storage,
    tools: true,
  });
}

let jarvisKnowledgeInstance: Promise<Knowledge> | null = null;

/**
 * Jarvis's Knowledge, one per process.
 *
 * One instance, not one per vertical: Mastra refuses two Knowledge instances on one storage backend
 * (`MASTRA_ADD_KNOWLEDGE_SHARED_STORAGE`), and every table here lives in the same SQLite file. A
 * vertical gets a scope or pages in this instance instead.
 */
export function getJarvisKnowledge(): Promise<Knowledge> {
  jarvisKnowledgeInstance ??= getMastraStorageProvider().then(createJarvisKnowledge);
  return jarvisKnowledgeInstance;
}

/**
 * What an agent is given to use Jarvis's Knowledge: the instance, which brings its tools and their
 * usage instructions, and the household scope its runs hold.
 *
 * The scope is the agent's own `scopes` option because that is the only place a run's scopes are
 * taken from once Mastra has a server registered: it refuses scopes passed on a call or through the
 * request context, so a request body can never claim one.
 */
export function householdKnowledgeOptions(knowledge: Knowledge) {
  return { knowledge, scopes: [HOUSEHOLD_SCOPE] };
}
