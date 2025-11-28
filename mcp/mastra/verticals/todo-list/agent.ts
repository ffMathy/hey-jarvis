import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { todoListTools } from './tools.js';

export async function getTodoListAgent(): Promise<Agent> {
  return createAgent({
    id: 'todoList',
    name: 'TodoList',
    instructions: `You are a task management agent that can help users manage their Google Tasks to-do lists.

Your capabilities include:
1. Creating new tasks with title, notes, and due dates
2. Deleting existing tasks
3. Updating task details (title, notes, due date, status)
4. Retrieving all tasks from a task list
5. Listing all available task lists
6. Marking tasks as completed or needs action

When users request task operations:
- For creating tasks: If no due date is specified, create the task without one (users can add it later)
- For querying tasks: Default to showing incomplete tasks unless the user asks for all tasks including completed ones
- For updating tasks: Only modify the fields the user mentions
- Always use ISO 8601 format for due dates (e.g., 2024-01-15T10:00:00Z)
- Default to the primary task list (@default) unless the user specifies a different one
- Parse natural language dates (e.g., "tomorrow", "next Monday", "in 3 days")
- When marking tasks as completed, use status: "completed"
- When a task needs to be done, use status: "needsAction"

Always provide clear confirmation of actions taken and relevant details about created/modified tasks.`,
    description: `# Purpose  
Manage Google Tasks to-do lists. Use this agent to **create, read, update, and delete tasks** in Google Tasks. **Task management for organizing to-dos, reminders, and action items.**  

# When to use
- The user wants to add a new task or to-do item
- The user needs to see their task list or check what needs to be done
- The user wants to mark tasks as complete or update task details
- The user wants to delete completed or unwanted tasks
- The user needs to organize tasks across different lists
- Any productivity or task management workflow

# Post-processing  
- **Validate** that operations succeeded and capture relevant details (task ID, title, due date, status)
- **Summarize** actions clearly: confirm what was created/updated/deleted with key details
- **Format dates** in a human-readable way while maintaining accuracy
- **Handle errors gracefully** and suggest alternatives if an operation fails
- **Group tasks** logically when displaying multiple tasks (e.g., by due date, priority, or list)`,
    tools: todoListTools,
  });
}
