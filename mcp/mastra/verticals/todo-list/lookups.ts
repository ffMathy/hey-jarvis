import { asFacts, createDirectLookup } from '../../utils/direct-lookup-factory.js';
import { getAllTasks } from './tools.js';

/**
 * "What is on my to-do list" answered without the agent: the open tasks in the default list,
 * which is what the agent's instructions default to. Like the agent's call, it reports that list,
 * by its real id, as what it read.
 */
export const todoListLookups = [
  createDirectLookup({
    id: 'todoList.open',
    agentId: 'todoList',
    description: 'What is on the to-do list: the tasks that are not done yet',
    answer: async (callTool) => {
      const { tasks } = await callTool(getAllTasks, {
        taskListId: '@default',
        showCompleted: false,
        maxResults: 100,
      });
      return asFacts({ tasks: tasks.map(({ title, notes, due }) => ({ title, notes, due })) });
    },
  }),
];
