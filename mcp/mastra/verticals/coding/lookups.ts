import { asFacts, createDirectLookup } from '../../utils/direct-lookup-factory.js';
import { listRepositoryIssues } from './tools.js';

/**
 * "What issues are open?" answered without the agent: the open issues on Jarvis's own repository,
 * which is the one the agent's instructions default to. Numbers and titles only -- the bodies are
 * for reading, not for saying. Like the agent's call, it reports that repository as what it read.
 */
export const codingLookups = [
  createDirectLookup({
    id: 'coding.openIssues',
    agentId: 'coding',
    description: "Which issues are open on Jarvis's own repository",
    answer: async (callTool) => {
      const { issues, total_count } = await callTool(listRepositoryIssues, { state: 'open' });
      return asFacts({
        openIssues: total_count,
        issues: issues.map(({ number, title, labels }) => ({
          number,
          title,
          labels: (labels ?? []).map((label) => label.name),
        })),
      });
    },
  }),
];
