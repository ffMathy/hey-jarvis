import { Knowledge, type KnowledgeScopeDeclarations, knowledgeMemoryScopes } from '@mastra/core/knowledge';
import type { MastraCompositeStore } from '@mastra/core/storage';

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

/**
 * The scopes Jarvis's Knowledge knows: Memory's `thread:` and `resource:` scopes, under the household.
 *
 * Every scope an attached agent's run holds must match one of these, or the run is refused. Those
 * runs hold the household, and, through Memory, the `resource:` and `thread:` of the conversation.
 */
function jarvisKnowledgeScopes(): KnowledgeScopeDeclarations {
  const scopes = knowledgeMemoryScopes({ org: HOUSEHOLD_SCOPE_PATTERN });
  return {
    ...scopes,
    [HOUSEHOLD_SCOPE_PATTERN]: {
      ...scopes[HOUSEHOLD_SCOPE_PATTERN],
      displayLabel: 'Household',
      description: "The household Jarvis runs: facts, conventions and state every one of Jarvis's agents shares.",
    },
  };
}

/**
 * Builds Jarvis's Knowledge.
 *
 * Without `storage` it takes the Mastra instance's store when it is registered, which is the shared
 * SQLite file everything else lives in; LibSQL implements Knowledge's storage domain. A test passes
 * its own, such as an `InMemoryStore`.
 *
 * Search is keyword-only: no vector store or embedder. Semantic search would embed every page and
 * note written, with the hosted embedder Memory uses, and this database has filled its disk with
 * embeddings once already (see `.claude/rules/mcp-state-change-notification-workflow.md`).
 */
export function createJarvisKnowledge(options: { storage?: MastraCompositeStore } = {}): Knowledge {
  return new Knowledge({
    id: JARVIS_KNOWLEDGE_KEY,
    name: 'Jarvis',
    description: "What Jarvis knows about the household he runs, shared by all of Jarvis's agents.",
    scopes: jarvisKnowledgeScopes(),
    storage: options.storage,
    tools: true,
  });
}

let jarvisKnowledgeInstance: Knowledge | null = null;

/**
 * Jarvis's Knowledge, one per process.
 *
 * One instance, not one per vertical: Mastra refuses two Knowledge instances on one storage backend
 * (`MASTRA_ADD_KNOWLEDGE_SHARED_STORAGE`), and every table here lives in the same SQLite file. A
 * vertical gets pages in this instance instead.
 */
export function getJarvisKnowledge(): Knowledge {
  jarvisKnowledgeInstance ??= createJarvisKnowledge();
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
export function householdKnowledgeOptions(knowledge: Knowledge = getJarvisKnowledge()) {
  return { knowledge, scopes: [HOUSEHOLD_SCOPE] };
}
