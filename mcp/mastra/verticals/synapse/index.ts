// Synapse vertical exports
export { getStateChangeReactorAgent } from './agent.js';
export { describeStateChange, type StateChange } from './state-change.js';
export { StateChangeBatcher, stateChangeBatcher } from './state-change-batcher.js';
export {
  DEFAULT_MAXIMUM_MATCHES,
  DEFAULT_MINIMUM_SCORE,
  findRelevantSubscriptions as findRelevantSubscriptionsForDescription,
  findSubscriptionsForStateChange,
  formatSubscriptionMatches,
  rankSubscriptions,
  type SubscriptionMatch,
  type SubscriptionMatchOptions,
} from './subscription-matcher.js';
export { subscriptionTools } from './subscription-tools.js';
export { flushStateChanges, getStateChangeBatcherStats, synapseTools } from './tools.js';
export { stateChangeNotificationWorkflow } from './workflows.js';
