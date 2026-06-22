#!/usr/bin/env node

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { BuiltInToolsInput, GetAgentResponseModel } from '@elevenlabs/elevenlabs-js/api';
import { McpApprovalPolicy } from '@elevenlabs/elevenlabs-js/api';
import { Command } from 'commander';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { cwd } from 'process';

// The shared ElevenLabs MCP server registration that points at the local cloudflared tunnel used by
// the test agent. The agent reaches routePromptWorkflow through this server.
const TEST_MCP_SERVER_ID = 'GMOqF385QS1GsrZKfQk6';

class ElevenLabsAgentManager {
  private client: ElevenLabsClient;

  constructor() {
    const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('HEY_JARVIS_ELEVENLABS_API_KEY environment variable is required');
    }
    this.client = new ElevenLabsClient({ apiKey });
  }

  private getAssetsPath(): string {
    return path.join(cwd(), 'elevenlabs', 'src', 'assets');
  }

  private filterSensitiveData(
    config: GetAgentResponseModel,
  ): Omit<GetAgentResponseModel, 'phoneNumbers' | 'accessInfo' | 'agentId'> {
    // Use type assertion for mutable operations since we're intentionally removing properties
    const filtered = { ...config } as Partial<GetAgentResponseModel>;

    // Remove sensitive data that should not be persisted
    delete filtered.phoneNumbers;
    delete filtered.accessInfo;
    delete filtered.agentId;

    // Remove nested sensitive data if it exists (voice_id might be added dynamically)
    if (filtered.conversationConfig?.tts) {
      delete (filtered.conversationConfig.tts as Partial<typeof filtered.conversationConfig.tts>).voiceId;
    }

    // Remove webhook URLs from tools as they contain secrets
    if (filtered.conversationConfig?.agent?.prompt?.tools) {
      filtered.conversationConfig.agent.prompt.tools = filtered.conversationConfig.agent.prompt.tools.map((tool) => {
        if (tool.type === 'webhook' && tool.apiSchema?.url) {
          const toolCopy = { ...tool };
          // Remove the URL which contains webhook secrets
          if (toolCopy.apiSchema) {
            delete (toolCopy.apiSchema as Partial<typeof toolCopy.apiSchema>).url;
          }
          return toolCopy;
        }
        return tool;
      });
    }

    return filtered as Omit<GetAgentResponseModel, 'phoneNumbers' | 'accessInfo' | 'agentId'>;
  }

  private async saveConfig(config: GetAgentResponseModel): Promise<void> {
    const assetsPath = this.getAssetsPath();
    const configPath = path.join(assetsPath, 'agent-config.json');
    const filteredConfig = this.filterSensitiveData(config);

    // Ensure the assets directory exists
    await mkdir(assetsPath, { recursive: true });

    await writeFile(configPath, JSON.stringify(filteredConfig, null, 2), 'utf-8');
    console.log(`✅ Configuration saved to ${configPath} (sensitive data filtered)`);
  }

  private async loadConfig(): Promise<Partial<GetAgentResponseModel>> {
    const assetsPath = this.getAssetsPath();
    const configPath = path.join(assetsPath, 'agent-config.json');

    try {
      await access(configPath);
    } catch {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const fileContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(fileContent);
    console.log(`📂 Configuration loaded from ${configPath}`);
    return config;
  }

  private async loadPrompt(): Promise<string> {
    const assetsPath = this.getAssetsPath();
    const promptPath = path.join(assetsPath, 'agent-prompt.md');

    try {
      await access(promptPath);
    } catch {
      throw new Error(`Prompt file not found: ${promptPath}`);
    }

    const prompt = await readFile(promptPath, 'utf-8');
    console.log(`📂 Prompt loaded from ${promptPath}`);
    return prompt.trim();
  }

  private async savePrompt(prompt: string): Promise<void> {
    const assetsPath = this.getAssetsPath();
    const promptPath = path.join(assetsPath, 'agent-prompt.md');

    // Ensure the assets directory exists
    await mkdir(assetsPath, { recursive: true });

    await writeFile(promptPath, prompt, 'utf-8');
    console.log(`✅ Prompt saved to ${promptPath}`);
  }

  private async fetchAgentConfig(): Promise<void> {
    const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
    if (!agentId) {
      throw new Error('HEY_JARVIS_ELEVENLABS_AGENT_ID environment variable is required');
    }

    console.log(`📡 Fetching configuration for agent ${agentId}...`);

    const response = await this.client.conversationalAi.agents.get(agentId);

    console.log('✅ Agent configuration fetched successfully');
    console.log(`📋 Agent Name: ${response.name}`);
    console.log(`🆔 Agent ID: ${response.agentId}`);

    // Extract and save prompt separately
    await this.savePrompt(response.conversationConfig?.agent?.prompt?.prompt || '');

    // Remove prompt from config before saving
    const configToSave = { ...response };
    if (configToSave.conversationConfig?.agent?.prompt) {
      delete (
        configToSave.conversationConfig.agent.prompt as Partial<typeof configToSave.conversationConfig.agent.prompt>
      ).prompt;
    }

    await this.saveConfig(configToSave);
  }

  private resolveAgentId(isTestAgent: boolean): string {
    const agentId = isTestAgent
      ? process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID
      : process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;

    if (!agentId) {
      const envVarName = isTestAgent ? 'HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID' : 'HEY_JARVIS_ELEVENLABS_AGENT_ID';
      throw new Error(`${envVarName} environment variable is required`);
    }

    return agentId;
  }

  private injectEnvironmentVariables(
    config: Partial<GetAgentResponseModel>,
    agentId: string,
    voiceId: string | undefined,
  ): void {
    config.agentId = agentId;
    if (voiceId && config.conversationConfig?.tts) {
      // voice_id is not part of the official AgentConfig but may be needed by the API
      config.conversationConfig.tts.voiceId = voiceId;
    }
  }

  private applyTestAgentOverrides(config: Partial<GetAgentResponseModel>): void {
    // Set textOnly to true for test agents
    if (config.conversationConfig?.conversation) {
      config.conversationConfig.conversation.textOnly = true;
      console.log('🔧 Setting textOnly to true for test agent');
    }

    // Replace MCP server IDs with local tunnel MCP server for testing
    if (config.conversationConfig?.agent?.prompt) {
      config.conversationConfig.agent.prompt.mcpServerIds = [TEST_MCP_SERVER_ID];
      console.log('🔧 Setting mcpServerIds to local tunnel MCP server for test agent');

      config.conversationConfig.agent.prompt.tools = [];
      console.log('🔧 Clearing tools array for test agent');

      // Disable all built-in/system tools (end_call, transfer_to_agent, skip_turn, etc.) for the
      // test agent. These live in builtInTools, separate from the tools array. Post-deploy
      // verification proved the ElevenLabs update API is a merge-PATCH that ignores EMPTY values:
      // sending `builtInTools: {}` was silently dropped, leaving the live system tools in place, so
      // the model kept answering "what's the weather?" by calling end_call/transfer_to_agent instead
      // of the MCP routePromptWorkflow tool. The API's documented disable signal is an explicit
      // `null` per key, so we send null for every built-in tool. Removing them leaves
      // routePromptWorkflow as the only actionable tool, forcing the model to route live-data
      // requests rather than hang up or transfer.
      //
      // The generated SDK type models each key as an optional SystemToolConfigInput and does not
      // express the API's "null disables the tool" contract. NullableBuiltInTools is a supertype of
      // BuiltInToolsInput (same keys, additionally allowing null), so the single assertion below is a
      // safe downcast rather than an unrelated/unknown cast.
      type NullableBuiltInTools = { [K in keyof BuiltInToolsInput]?: BuiltInToolsInput[K] | null };
      const disabledBuiltInTools: NullableBuiltInTools = {
        endCall: null,
        languageDetection: null,
        transferToAgent: null,
        transferToNumber: null,
        skipTurn: null,
        playKeypadTouchTone: null,
        voicemailDetection: null,
      };
      config.conversationConfig.agent.prompt.builtInTools = disabledBuiltInTools as BuiltInToolsInput;
      console.log('🔧 Disabling all builtInTools (system tools) for test agent via explicit nulls');
    }

    // Suffix agent name with " (test)" to distinguish from production
    if (config.name && !config.name.endsWith(' (test)')) {
      config.name = `${config.name} (test)`;
      console.log(`🏷️ Renaming agent to: ${config.name}`);
    }
  }

  private async deployConfig(isTestAgent: boolean = false): Promise<void> {
    const config = await this.loadConfig();
    const prompt = await this.loadPrompt();

    // Inject prompt into config
    if (config.conversationConfig?.agent) {
      config.conversationConfig.agent.prompt = {
        prompt: prompt,
      };
    }

    const agentId = this.resolveAgentId(isTestAgent);
    const voiceId = process.env.HEY_JARVIS_ELEVENLABS_VOICE_ID;

    this.injectEnvironmentVariables(config, agentId, voiceId);

    if (isTestAgent) {
      this.applyTestAgentOverrides(config);
    }

    const agentType = isTestAgent ? 'test agent' : 'agent';
    console.log(`🚀 Deploying configuration to ${agentType} ${agentId}...`);

    const response = await this.client.conversationalAi.agents.update(agentId, config);

    console.log('✅ Agent configuration deployed successfully');
    console.log(`📋 Agent Name: ${response.name}`);
    console.log(`🆔 Agent ID: ${response.agentId}`);
    if (voiceId) {
      console.log(`🎤 Voice ID: ${voiceId}`);
    }
    if (isTestAgent) {
      console.log('🧪 Test agent mode enabled (textOnly: true)');
      await this.ensureTestMcpServerAutoApproves();
      await this.verifyTestAgentDeployment(agentId);
    }
  }

  /**
   * Sets the test MCP server's approval policy to auto_approve_all. Without this, routePromptWorkflow
   * requires per-call approval, so the agent cannot execute it autonomously in an automated text-only
   * test: the model decides to route but its tool call leaks out as a `[tool_code]` text block instead
   * of a real, executed tool call, and the weather spec sees no tool invocation. Auto-approving makes
   * routePromptWorkflow a directly callable function for the agent.
   */
  private async ensureTestMcpServerAutoApproves(): Promise<void> {
    console.log(`🔧 Setting test MCP server ${TEST_MCP_SERVER_ID} approval policy to auto_approve_all...`);
    await this.client.conversationalAi.mcpServers.update(TEST_MCP_SERVER_ID, {
      approvalPolicy: McpApprovalPolicy.AutoApproveAll,
    });
  }

  /**
   * Reads the test agent back after deploying and verifies the test overrides actually took effect
   * on the live agent. The ElevenLabs update API performs a partial merge, so it is easy for an
   * override to silently not apply (e.g. an empty builtInTools object leaves the existing system
   * tools in place). When that happens the agent answers live-data requests by calling system tools
   * like end_call / transfer_to_agent instead of the MCP routePromptWorkflow tool, and the weather
   * spec fails deep inside a long test run. Failing here instead surfaces the real deployed state
   * immediately, right next to the deploy step.
   */
  private async verifyTestAgentDeployment(agentId: string): Promise<void> {
    console.log('🔎 Verifying test agent deployment...');
    const live = await this.client.conversationalAi.agents.get(agentId);
    const prompt = live.conversationConfig?.agent?.prompt;

    const builtInTools = prompt?.builtInTools ?? {};
    const enabledBuiltInTools = Object.entries(builtInTools)
      .filter(([, value]) => value != null)
      .map(([key]) => key);
    const customToolCount = prompt?.tools?.length ?? 0;
    const mcpServerIds = prompt?.mcpServerIds ?? [];
    const nativeMcpServerIds = prompt?.nativeMcpServerIds ?? [];

    const mcpServer = await this.client.conversationalAi.mcpServers.get(TEST_MCP_SERVER_ID);
    const approvalPolicy = mcpServer.config.approvalPolicy;

    console.log(`🔎 Live agent name: ${live.name}`);
    console.log(`🔎 Live enabled builtInTools: [${enabledBuiltInTools.join(', ')}]`);
    console.log(`🔎 Live prompt.tools count: ${customToolCount}`);
    console.log(`🔎 Live mcpServerIds: [${mcpServerIds.join(', ')}]`);
    console.log(`🔎 Live nativeMcpServerIds: [${nativeMcpServerIds.join(', ')}]`);
    console.log(`🔎 Live test MCP server approval policy: ${approvalPolicy}`);

    const problems: string[] = [];
    if (!mcpServerIds.includes(TEST_MCP_SERVER_ID)) {
      problems.push(`expected test MCP server ${TEST_MCP_SERVER_ID} in mcpServerIds, got [${mcpServerIds.join(', ')}]`);
    }
    if (approvalPolicy !== McpApprovalPolicy.AutoApproveAll) {
      problems.push(
        `test MCP server approval policy is "${approvalPolicy}", expected "${McpApprovalPolicy.AutoApproveAll}" — ` +
          `routePromptWorkflow won't be auto-executable and the model will emit it as [tool_code] text instead of calling it`,
      );
    }
    if (enabledBuiltInTools.length > 0) {
      problems.push(
        `built-in system tools still enabled: [${enabledBuiltInTools.join(', ')}] — these shadow routePromptWorkflow ` +
          `and let the model answer with end_call/transfer_to_agent instead of routing`,
      );
    }
    // Note: prompt.tools is the deprecated system-tool mirror and cannot be cleared via the merge
    // API (an empty array is ignored). builtInTools above is the authoritative source the runtime
    // uses for system tools, so a non-zero count here is logged for visibility but is not fatal.
    if (customToolCount > 0) {
      console.log(`ℹ️ Live prompt.tools still has ${customToolCount} (deprecated mirror; not fatal)`);
    }

    if (problems.length > 0) {
      throw new Error(`Test agent deployment did not apply as expected:\n - ${problems.join('\n - ')}`);
    }

    console.log('✅ Test agent deployment verified (system tools disabled, test MCP server set)');
  }

  public async run(): Promise<void> {
    const program = new Command();

    program.name('elevenlabs-agent').description('ElevenLabs Agent Configuration Manager').version('1.0.0');

    program
      .command('fetch')
      .description('Fetch agent configuration from ElevenLabs')
      .action(() => this.fetchAgentConfig());

    program
      .command('deploy')
      .description('Deploy agent configuration to ElevenLabs')
      .option('--test', 'Deploy to test agent with textOnly enabled')
      .action((options) => this.deployConfig(options.test));

    await program.parseAsync();
  }
}

// Run the application
async function main(): Promise<void> {
  try {
    await new ElevenLabsAgentManager().run();
  } catch (error) {
    console.error('❌ Application error:', error);
    process.exit(1);
  }
}

void main();
