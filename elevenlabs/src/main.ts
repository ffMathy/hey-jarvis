#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { GetAgentResponseModel } from '@elevenlabs/elevenlabs-js/api';

class ElevenLabsAgentManager {
  private client: ElevenLabsClient;

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }
    this.client = new ElevenLabsClient({ apiKey });
  }

  private getAssetsPath(): string {
    const projectRoot = path.resolve(__dirname, '../../../..');
    return path.join(projectRoot, 'elevenlabs', 'src', 'assets');
  }

  private filterSensitiveData(config: GetAgentResponseModel): Omit<GetAgentResponseModel, 'phoneNumbers' | 'accessInfo' | 'agentId'> {
    const filtered = { ...config };
    
    // Remove sensitive data that should not be persisted
    delete filtered.phoneNumbers;
    delete filtered.accessInfo;
    delete filtered.agentId;
    
    // Remove nested sensitive data if it exists (voice_id might be added dynamically)
    if (filtered.conversationConfig?.tts) {
      delete filtered.conversationConfig.tts.voiceId;
    }
    
    return filtered;
  }

  private async saveConfig(config: GetAgentResponseModel): Promise<void> {
    const assetsPath = this.getAssetsPath();
    const configPath = path.join(assetsPath, 'agent-config.json');
    const filteredConfig = this.filterSensitiveData(config);
    
    // Ensure the assets directory exists
    await fs.ensureDir(assetsPath);
    
    await fs.writeFile(configPath, JSON.stringify(filteredConfig, null, 2));
    console.log(`✅ Configuration saved to ${configPath} (sensitive data filtered)`);
  }

  private async loadConfig(): Promise<Partial<GetAgentResponseModel>> {
    const assetsPath = this.getAssetsPath();
    const configPath = path.join(assetsPath, 'agent-config.json');
    
    if (!await fs.pathExists(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    
    const config = await fs.readJson(configPath);
    console.log(`📂 Configuration loaded from ${configPath}`);
    return config;
  }

  private async loadPrompt(): Promise<string> {
    const assetsPath = this.getAssetsPath();
    const promptPath = path.join(assetsPath, 'agent-prompt.md');
    
    if (!await fs.pathExists(promptPath)) {
      throw new Error(`Prompt file not found: ${promptPath}`);
    }
    
    const prompt = await fs.readFile(promptPath, 'utf-8');
    console.log(`📂 Prompt loaded from ${promptPath}`);
    return prompt.trim();
  }

  private async savePrompt(prompt: string): Promise<void> {
    const assetsPath = this.getAssetsPath();
    const promptPath = path.join(assetsPath, 'agent-prompt.md');
    
    // Ensure the assets directory exists
    await fs.ensureDir(assetsPath);
    
    await fs.writeFile(promptPath, prompt);
    console.log(`✅ Prompt saved to ${promptPath}`);
  }

  private async fetchAgentConfig(): Promise<void> {
    try {
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      if (!agentId) {
        throw new Error('ELEVENLABS_AGENT_ID environment variable is required');
      }

      console.log(`📡 Fetching configuration for agent ${agentId}...`);
      
      const response = await this.client.conversationalAi.agents.get(agentId);
      
      console.log('✅ Agent configuration fetched successfully');
      console.log(`📋 Agent Name: ${response.name}`);
      console.log(`🆔 Agent ID: ${response.agentId}`);
      
      // Extract and save prompt separately
      let prompt = 'You are Jarvis, an advanced AI assistant.'; // fallback
      
      if (response.conversationConfig?.agent?.prompt) {
        const agentPrompt = response.conversationConfig.agent.prompt;
        prompt = typeof agentPrompt === 'string' ? agentPrompt : (agentPrompt?.prompt || prompt);
      }
      
      await this.savePrompt(prompt);
      
      // Remove prompt from config before saving
      const configToSave = { ...response };
      if (configToSave.conversationConfig?.agent) {
        delete configToSave.conversationConfig.agent.prompt;
      }
      
      await this.saveConfig(configToSave);
    } catch (error) {
      console.error('❌ Failed to fetch configuration:', error);
      process.exit(1);
    }
  }

  private async deployConfig(): Promise<void> {
    try {
      const config = await this.loadConfig();
      const prompt = await this.loadPrompt();
      
      // Inject prompt into config
      if (config.conversationConfig?.agent) {
        config.conversationConfig.agent.prompt = {
          prompt: prompt
        };
      }
      
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      
      if (!agentId) {
        throw new Error('ELEVENLABS_AGENT_ID environment variable is required');
      }
      
      // Inject environment variables into config
      config.agentId = agentId;
      if (voiceId && config.conversationConfig?.agent) {
        // voice_id is not part of the official AgentConfig but may be needed by the API
        (config.conversationConfig.agent as unknown as Record<string, unknown>).voice_id = voiceId;
      }
      
      console.log(`🚀 Deploying configuration to agent ${agentId}...`);
      
      const response = await this.client.conversationalAi.agents.update(
        agentId,
        config
      );
      
      console.log('✅ Agent configuration deployed successfully');
      console.log(`📋 Agent Name: ${response.name}`);
      console.log(`🆔 Agent ID: ${response.agentId}`);
      if (voiceId) {
        console.log(`🎤 Voice ID: ${voiceId}`);
      }
    } catch (error) {
      console.error('❌ Failed to deploy configuration:', error);
      process.exit(1);
    }
  }

  public async run(): Promise<void> {
    const program = new Command();
    
    program
      .name('elevenlabs-agent')
      .description('ElevenLabs Agent Configuration Manager')
      .version('1.0.0');

    program
      .command('fetch')
      .description('Fetch agent configuration from ElevenLabs')
      .action(() => this.fetchAgentConfig());

    program
      .command('deploy')
      .description('Deploy agent configuration to ElevenLabs')
      .action(() => this.deployConfig());

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
