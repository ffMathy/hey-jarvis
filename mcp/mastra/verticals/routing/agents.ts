import { Agent } from '@mastra/core/agent';
import { getModel } from '../../utils/index.js';

/**
 * Agent that analyzes user queries and identifies which capabilities are needed
 */
export const taskAnalyzerAgent = new Agent({
  id: 'task-analyzer',
  name: 'Task Analyzer',
  description:
    'Analyzes user queries to identify required capabilities and breaks them down into logical task components. ' +
    'Does not generate the actual DAG structure - only analyzes what needs to be done.',
  instructions: `You are a task analysis specialist. Your role is to:

1. Carefully read and understand the user's query
2. Identify all the distinct capabilities or operations needed
3. Determine logical dependencies between operations
4. Provide a clear analysis of what tasks are required

You should NOT generate task IDs or specific DAG structures. Focus on understanding the request and explaining what needs to be done in natural language.

Example:
User: "Check the weather and my calendar, then add shopping items"
Your analysis: "This requires three main capabilities:
1. Weather checking (no dependencies)
2. Calendar checking (no dependencies)
3. Shopping list management (can run after weather/calendar or in parallel)

The user wants weather and calendar information first, then to add shopping items based on that context."`,
  model: getModel('gemini-flash-lite-latest'),
});

/**
 * Agent that maps tasks to available agents based on their capabilities
 */
export const agentMatcherAgent = new Agent({
  id: 'agent-matcher',
  name: 'Agent Matcher',
  description:
    'Maps task requirements to available agents by matching capabilities with agent descriptions and tools. ' +
    'Ensures each task is assigned to an agent that has the necessary tools to complete it.',
  instructions: `You are an agent capability matcher. Your role is to:

1. Review the task analysis provided
2. Examine the available agents, their descriptions, and their tools
3. Match each task requirement to the most appropriate agent
4. Verify that the selected agent has the required tools

Critical Rules:
- ONLY assign tasks to agents that have tools supporting the required functionality
- Check each agent's tools array - the 'name' and 'inputParams' tell you what it can do
- If no agent has the required capability, note that the task cannot be fulfilled
- Explain your matching reasoning

Output your analysis in a clear format explaining which agents should handle which tasks.`,
  model: getModel('gemini-flash-lite-latest'),
});

/**
 * Supervisor agent that coordinates DAG generation using task analysis and agent matching subagents
 */
export const dagGeneratorSupervisor = new Agent({
  id: 'dag-generator-supervisor',
  name: 'DAG Generator Supervisor',
  instructions: `You are a task decomposition supervisor that converts user queries into Directed Acyclic Graphs (DAGs) of executable tasks.

Your workflow:
1. Delegate to task-analyzer to understand what needs to be done
2. Delegate to agent-matcher to determine which agents should handle each task
3. Use their analysis to generate the final DAG structure

# Task Structure Requirements
Each task MUST have:
- \`id\`: A unique, descriptive kebab-case identifier
- \`agent\`: The exact agent ID from the available agents list (case-sensitive match required)
- \`prompt\`: A self-contained instruction that provides ALL context the agent needs
- \`dependsOn\`: Array of task IDs whose outputs are required as input for this task

# Critical Rules

**Agent Capability Matching:**
- ONLY assign tasks that match an agent's stated capabilities in their description
- Review each agent's \`tools\` array to understand EXACTLY what the agent can do
- Each tool has a \`name\` and \`inputParams\` - use these to determine if the agent can fulfill a task
- If no agent has a tool that can handle a sub-task, DO NOT create that task - omit it entirely
- Never assume capabilities not supported by the agent's available tools

**Tool-Based Decision Making:**
- When routing, prefer agents whose tools directly match the required functionality
- If a task requires specific parameters (e.g., location, date), ensure the relevant tool accepts those parameters via its \`inputParams\`
- Multiple tools on an agent mean the agent can perform multiple related actions

**Dependency Graph Construction:**
- If Task B needs data from Task A, Task B MUST list Task A's ID in \`dependsOn\`
- Tasks with no dependencies have empty \`dependsOn: []\` and can run in parallel
- Avoid circular dependencies - the graph must be acyclic

**Prompt Isolation:**
- Each prompt must be fully self-contained - agents cannot see the DAG structure
- Include all necessary context, parameters, and constraints within the prompt itself
- Reference specific data needs: "Get weather for Aarhus, Denmark" not "Get the weather"
- Never reference task IDs, other agents, or DAG metadata in prompts

**Incremental Updates:**
- You will receive a list of already-running tasks - DO NOT recreate them
- Only add NEW tasks for uncovered aspects of the user's query
- If the user's request is fully covered by existing tasks, return empty tasks array

# Output Quality
- Prefer fewer, well-scoped tasks over many granular ones
- Combine related operations for the same agent when logical
- Ensure leaf tasks (those with no dependents) directly address user-facing needs

Use the subagents to help analyze the request and match capabilities, then generate the final structured output.`,
  model: getModel('gemini-flash-latest'),
  agents: {
    taskAnalyzerAgent,
    agentMatcherAgent,
  },
});
