import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which ElevenLabs conversation the work in progress is serving.
 *
 * A routed request is started by one tool call and carried out long after it has returned: the
 * planner, the classifier, the plan run and every agent and tool in it run in the background
 * while the voice agent polls. None of them is handed the conversation, and threading it through
 * every one would mean a parameter on most of the routing controller. So it is held in async
 * context instead, set once where the request arrives (`routePromptWorkflow`), and every promise
 * started inside that call inherits it.
 *
 * What reads it:
 *
 * - **Traces.** {@link conversationTracingOptions} puts it on a run's root span as the
 *   `sessionId` metadata key, which Mastra copies onto every child span and stores in a column
 *   of its own — so `listTraces({ filters: { sessionId } })` returns everything one
 *   conversation set in motion, and every log written inside one of those spans carries it too.
 * - **The diagnostics ring** (`diagnostics.ts`), for the warnings routing logs outside any span.
 *
 * Analysis Mode reads both back through the reflection agent's `describeConversation`.
 */
const conversationScope = new AsyncLocalStorage<string>();

/**
 * The voice agent's prompt names the conversation through `{{system__conversation_id}}`, which
 * ElevenLabs substitutes before the model reads it. A client that does not substitute — a text
 * test, a caller other than ElevenLabs — hands the placeholder through as written, and filing
 * work under the literal placeholder would merge every such conversation into one.
 */
function isConversationId(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && !value.includes('{{');
}

/**
 * Runs `work` as part of a conversation, so everything it starts — synchronously or in promises
 * it leaves running — is filed under it. Without an id it runs in whatever scope it was called in.
 */
export function withinConversation<T>(conversationId: string | undefined, work: () => T): T {
  return isConversationId(conversationId) ? conversationScope.run(conversationId.trim(), work) : work();
}

/** The conversation the current work is serving, when it was started from one. */
export function currentConversationId(): string | undefined {
  return conversationScope.getStore();
}

/**
 * The options that file a run's trace under a conversation, to spread into an agent's
 * `generate`/`stream`/`resumeStream` options or a workflow run's `start`/`stream`.
 *
 * Empty outside a conversation, so a scheduled run or a Studio session is traced as before.
 */
export function conversationTracingOptions(conversationId = currentConversationId()): {
  tracingOptions?: { metadata: { sessionId: string } };
} {
  return isConversationId(conversationId) ? { tracingOptions: { metadata: { sessionId: conversationId.trim() } } } : {};
}
