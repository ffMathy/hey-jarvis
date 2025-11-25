#!/usr/bin/env node

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { GetAgentResponseModel } from '@elevenlabs/elevenlabs-js/api';
import { Command } from 'commander';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { cwd } from 'process';

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
    const filtered = { ...config };

    // Remove sensitive data that should not be persisted
    delete filtered.phoneNumbers;
    delete filtered.accessInfo;
    delete filtered.agentId;

    // Remove nested sensitive data if it exists (voice_id might be added dynamically)
    if (filtered.conversationConfig?.tts) {
      delete filtered.conversationConfig.tts.voiceId;
    }

    // Remove webhook URLs from tools as they contain secrets
    if (filtered.conversationConfig?.agent?.prompt?.tools) {
      filtered.conversationConfig.agent.prompt.tools = filtered.conversationConfig.agent.prompt.tools.map((tool) => {
        if (tool.type === 'webhook' && tool.apiSchema?.url) {
          const toolCopy = { ...tool };
          // Remove the URL which contains webhook secrets
          if (toolCopy.apiSchema) {
            delete toolCopy.apiSchema.url;
          }
          return toolCopy;
        }
        return tool;
      });
    }

    return filtered;
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
    try {
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
      if (configToSave.conversationConfig?.agent) {
        delete configToSave.conversationConfig.agent.prompt.prompt;
      }

      await this.saveConfig(configToSave);
    } catch (error) {
      console.error('❌ Failed to fetch configuration:', error);
      process.exit(1);
    }
  }

  private async deployConfig(isTestAgent: boolean = false): Promise<void> {
    try {
      const config = await this.loadConfig();
      const prompt = await this.loadPrompt();

      // Inject prompt into config
      if (config.conversationConfig?.agent) {
        config.conversationConfig.agent.prompt = {
          prompt: prompt,
        };
      }

      const agentId = isTestAgent
        ? process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID
        : process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
      const voiceId = process.env.HEY_JARVIS_ELEVENLABS_VOICE_ID;

      if (!agentId) {
        const envVarName = isTestAgent ? 'HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID' : 'HEY_JARVIS_ELEVENLABS_AGENT_ID';
        throw new Error(`${envVarName} environment variable is required`);
      }

      // Inject environment variables into config
      config.agentId = agentId;
      if (voiceId && config.conversationConfig?.tts) {
        // voice_id is not part of the official AgentConfig but may be needed by the API
        config.conversationConfig.tts.voiceId = voiceId;
      }

      // Modify configuration for test agents
      if (isTestAgent) {
        // Set textOnly to true for test agents
        if (config.conversationConfig?.conversation) {
          config.conversationConfig.conversation.textOnly = true;
          console.log('🔧 Setting textOnly to true for test agent');
        }

        // Replace MCP server IDs with local tunnel MCP server for testing
        if (config.conversationConfig?.agent?.prompt) {
          config.conversationConfig.agent.prompt.mcpServerIds = ['GMOqF385QS1GsrZKfQk6'];
          console.log('🔧 Setting mcpServerIds to local tunnel MCP server for test agent');

          config.conversationConfig.agent.prompt.tools = [];
          console.log('🔧 Clearing tools array for test agent');
        }

        // Suffix agent name with " (test)" to distinguish from production
        if (config.name && !config.name.endsWith(' (test)')) {
          config.name = `${config.name} (test)`;
          console.log(`🏷️ Renaming agent to: ${config.name}`);
        }
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
      }
    } catch (error) {
      console.error('❌ Failed to deploy configuration:', error);
      process.exit(1);
    }
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
(async () => {
  try {
    const manager = new ElevenLabsAgentManager();
    await manager.run();
  } catch (error) {
    console.error('❌ Application error:', error);
    process.exit(1);
  }
})();
