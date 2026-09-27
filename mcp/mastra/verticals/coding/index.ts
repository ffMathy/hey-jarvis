// Coding vertical exports
export { getCodingAgent } from './agent.js';
export { getMissingClaudeCodeHostVariables, isClaudeCodeHostConfigured } from './claude-code-host.js';
export {
  type ClaudeSession,
  type ClaudeSessionEvent,
  type ClaudeSessionStatus,
  createClaudeSession,
  type FinishedClaudeSessionTurn,
  getClaudeSession,
  listLatestClaudeSessionMessages,
  readFinishedTurn,
  sendClaudeSessionMessage,
  streamClaudeSessionEvents,
  waitForClaudeSessionTurn,
} from './claude-sessions.js';
export {
  type ClaudeSessionContext,
  ClaudeSessionWatcher,
  CODING_STATE_CHANGE_SOURCE,
  claudeSessionWatcher,
  toStateChange,
} from './session-watcher.js';
export { codingTools } from './tools.js';
export { type CodebaseAnalysis, implementFeatureWorkflow, readCodebaseAnalysis } from './workflows.js';
