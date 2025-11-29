import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { Agent } from '@mastra/core/agent';
import { readFile } from 'fs/promises';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { getPublicAgents } from 'mcp/mastra/mcp-server.js';
import agentConfig from '../../src/assets/agent-config.json';
/**
 * Gemini-based implementation of ConversationStrategy using MCP tools
 * Connects Gemini directly to MCP servers for tool calling
 */
export class GeminiMastraConversationStrategy {
  apiKey;
  messages = [];
  isConnected = false;
  agent;
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.HEY_JARVIS_GOOGLE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('Google API key required: set HEY_JARVIS_GOOGLE_API_KEY or pass apiKey');
    }
  }
  async connect() {
    // Clear state from any previous connection
    this.messages = [];
    this.agent = undefined; // Reset agent on new connection
    this.isConnected = true;
  }
  async getJarvisAgent() {
    if (!this.agent) {
      // Create Google provider instance with API key
      const googleProvider = createGoogleGenerativeAI({
        apiKey: this.apiKey,
      });
      const agentPrompt = await this.readAgentPrompt();
      const agentsArray = await getPublicAgents();
      // Convert agents array to Record<string, Agent>
      const agents = {};
      for (const agent of agentsArray) {
        agents[agent.name] = agent;
      }
      // Extract tools from all agents
      const tools = {};
      for (const agent of agentsArray) {
        const agentTools = await agent.listTools();
        if (agentTools) {
          // Merge tools from each agent into the tools object
          Object.assign(tools, agentTools);
        }
      }
      this.agent = new Agent({
        id: 'jarvis',
        name: 'J.A.R.V.I.S.',
        instructions: agentPrompt,
        model: googleProvider(agentConfig.conversationConfig.agent.prompt.llm),
        agents,
        tools,
        workflows: {},
        inputProcessors: [],
        outputProcessors: [],
      });
    }
    return this.agent;
  }
  /**
   * Create an agent response server message
   */
  createAgentResponseMessage(responseText) {
    return {
      type: 'agent_response',
      agent_response_event: {
        agent_response: responseText,
      },
    };
  }
  /**
   * Create a tool call server message
   */
  createToolCallMessage(toolName, toolCallId, result) {
    return {
      type: 'mcp_tool_call',
      mcp_tool_call: {
        tool_name: toolName,
        tool_call_id: toolCallId,
        state: 'success',
        result: [result],
      },
    };
  }
  /**
   * Send a message to the agent and store both the message and response
   */
  async sendToAgent(agent, content, role, id) {
    const result = await agent.generate(
      {
        createdAt: new Date(),
        id,
        content,
        role,
        type: role === 'tool' ? 'tool-result' : 'text',
      },
      {
        modelSettings: { temperature: 0 },
      },
    );
    const responseText = (await result.text) || '';
    if (responseText) {
      this.messages.push(this.createAgentResponseMessage(responseText));
    }
    return responseText;
  }
  async sendMessage(text) {
    if (!this.isConnected) {
      throw new Error('Not connected. Call connect() first.');
    }
    // Get or create the agent
    const agent = await this.getJarvisAgent();
    // Store the user message
    const userMessage = {
      type: 'user_message',
      text,
    };
    this.messages.push(userMessage);
    // Call agent with user message
    const initialResult = await agent.generate(
      {
        createdAt: new Date(),
        type: 'text',
        id: 'message-' + this.messages.length.toString(),
        content: text,
        role: 'user',
      },
      {
        modelSettings: { temperature: 0 },
      },
    );
    const responseText = (await initialResult.text) || '';
    if (responseText) {
      this.messages.push(this.createAgentResponseMessage(responseText));
    }
    // Handle async tool execution pattern
    if (initialResult.toolResults && initialResult.toolResults.length > 0) {
      for (const toolCall of initialResult.toolResults) {
        // Step 1: Emit "in_progress" response
        const inProgressResult = {
          status: 'in_progress',
          message: 'Executing the task in the background. Result will be reported later.',
        };
        const inProgressMessage = this.createToolCallMessage(
          toolCall.payload.toolName,
          toolCall.runId + '_in_progress',
          JSON.stringify(inProgressResult),
        );
        this.messages.push(inProgressMessage);
        // Send in_progress to agent and store response
        await this.sendToAgent(agent, JSON.stringify(inProgressResult), 'tool', 'tool-in-progress-' + toolCall.runId);
        // Step 2: Emit the actual tool result
        const toolResultText = toolCall.payload.result['text'] || JSON.stringify(toolCall.payload.result);
        const toolMessage = this.createToolCallMessage(toolCall.payload.toolName, toolCall.runId, toolResultText);
        this.messages.push(toolMessage);
        // Send actual result to agent and store response
        await this.sendToAgent(agent, toolResultText, 'tool', 'tool-result-' + toolCall.runId);
      }
    }
    return responseText;
  }
  async readAgentPrompt() {
    const agentPrompt = await readFile('./elevenlabs/src/assets/agent-prompt.md', 'utf-8');
    const replacedAgentPrompt = agentPrompt
      .replace('{{system__time_utc}}', new Date().toISOString())
      .replace('{{system__time}}', new Date().toISOString());
    return replacedAgentPrompt;
  }
  getMessages() {
    return [...this.messages];
  }
  getTranscriptText() {
    return this.messages
      .map((msg) => {
        if (msg.type === 'user_message') {
          return `> USER: ${msg.text}`;
        } else if (msg.type === 'agent_response') {
          return `> AGENT: ${msg.agent_response_event.agent_response.trim()}`;
        } else if (msg.type === 'mcp_tool_call' && msg.mcp_tool_call.state === 'success') {
          return `> TOOL: ${msg.mcp_tool_call.tool_name} → ${JSON.stringify(msg.mcp_tool_call.result)}`;
        }
        return '';
      })
      .filter((x) => !!x)
      .join('\n');
  }
  async disconnect() {
    this.messages = [];
    this.agent = undefined;
    this.isConnected = false;
  }
}
//# sourceMappingURL=gemini-mastra-conversation-strategy.js.map
