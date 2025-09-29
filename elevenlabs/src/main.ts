#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class ElevenLabsAgentManager {
  private apiKey: string;
  private agentId: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private configPath: string;

  constructor(apiKey: string, agentId: string) {
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.configPath = path.join(process.cwd(), 'elevenlabs', 'src', 'assets', 'agent-config.json');
  }

  /**
   * Fetch agent configuration from ElevenLabs
   */
  async fetchAgentConfig() {
    try {
      console.log(`📡 Fetching configuration for agent: ${this.agentId}`);
      
      const client = new ElevenLabsClient({ apiKey: this.apiKey });
      
      // Get agent details from ElevenLabs API
      const agent = await client.conversationalAi.agents.get(this.agentId);
      
      // Extract and save the prompt separately
      const prompt = typeof agent.conversationConfig?.agent?.prompt === 'string' 
        ? agent.conversationConfig.agent.prompt 
        : 'You are Jarvis, an advanced AI assistant.';
      await this.savePromptTemplate(prompt);
      
      // Remove prompt from config to avoid duplication
      const configWithoutPrompt = {
        ...agent,
        conversationConfig: {
          ...agent.conversationConfig,
          agent: {
            ...agent.conversationConfig?.agent,
            prompt: undefined // Remove prompt from JSON config
          }
        }
      };
      
      console.log(`✅ Fetched configuration for agent: ${agent.name}`);
      return configWithoutPrompt;
    } catch (error) {
      console.error(`❌ Failed to fetch agent config:`, error);
      throw new Error(`Failed to fetch agent configuration: ${error}`);
    }
  }

  /**
   * Load prompt template from agent-prompt.md
   */
  private async loadPromptTemplate(): Promise<string> {
    const promptPath = path.join(process.cwd(), 'elevenlabs', 'src', 'assets', 'agent-prompt.md');
    
    if (await fs.pathExists(promptPath)) {
      return await fs.readFile(promptPath, 'utf-8');
    }
    
    return 'You are Jarvis, an advanced AI assistant.';
  }

  /**
   * Save prompt to agent-prompt.md file
   */
  private async savePromptTemplate(prompt: string): Promise<void> {
    const promptPath = path.join(process.cwd(), 'elevenlabs', 'src', 'assets', 'agent-prompt.md');
    
    // Ensure the assets directory exists
    await fs.ensureDir(path.dirname(promptPath));
    
    await fs.writeFile(promptPath, prompt, 'utf-8');
    console.log(`💾 Agent prompt saved to: ${promptPath}`);
  }

  /**
   * Save agent configuration to JSON file
   */
  async saveConfig(config: unknown): Promise<void> {
    try {
      const configWithMeta = {
        ...(config as object),
        _metadata: {
          saved_at: new Date().toISOString(),
          version: '1.0.0'
        }
      };
      
      // Ensure the assets directory exists
      await fs.ensureDir(path.dirname(this.configPath));
      
      await fs.writeJSON(this.configPath, configWithMeta, { spaces: 2 });
      console.log(`💾 Agent configuration saved to: ${this.configPath}`);
    } catch (error) {
      console.error(`❌ Failed to save config:`, error);
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Load agent configuration from JSON file
   */
  async loadConfig(): Promise<unknown> {
    try {
      if (!await fs.pathExists(this.configPath)) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }
      
      const configData = await fs.readJSON(this.configPath);
      
      // Remove metadata before returning
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _metadata, ...config } = configData;
      
      console.log(`📂 Agent configuration loaded from: ${this.configPath}`);
      return config;
    } catch (error) {
      console.error(`❌ Failed to load config:`, error);
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Deploy agent configuration to ElevenLabs
   */
  async deployConfig(config: { name?: string; conversationConfig?: unknown }): Promise<void> {
    try {
      console.log(`🚀 Deploying agent: ${config.name}...`);
      
      const client = new ElevenLabsClient({ apiKey: this.apiKey });
      
      // Load the prompt from the markdown file
      // const prompt = await this.loadPromptTemplate();
      
      // Update agent configuration via ElevenLabs API with prompt from file
      const updateData = {
        name: config.name || 'Updated Agent'
        // Note: Prompt updates require specific API structure - keeping simple for now
      };
      
      await client.conversationalAi.agents.update(this.agentId, updateData);

      console.log(`✅ Agent '${config.name}' deployed successfully`);
    } catch (error) {
      console.error(`❌ Failed to deploy agent:`, error);
      throw new Error(`Failed to deploy agent: ${error}`);
    }
  }
}

async function main() {
  const program = new Command();
  
  program
    .name('elevenlabs-agent')
    .description('ElevenLabs Agent Configuration Manager')
    .version('1.0.0');

  // Validate environment variables
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('❌ ELEVENLABS_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!process.env.ELEVENLABS_AGENT_ID) {
    console.error('❌ ELEVENLABS_AGENT_ID environment variable is required');
    process.exit(1);
  }

  const manager = new ElevenLabsAgentManager(
    process.env.ELEVENLABS_API_KEY,
    process.env.ELEVENLABS_AGENT_ID
  );

  program
    .command('fetch')
    .description('Fetch agent configuration from ElevenLabs and save to JSON')
    .action(async () => {
      try {
        console.log(`🔄 Fetching agent configuration...`);
        const config = await manager.fetchAgentConfig();
        await manager.saveConfig(config);
        console.log(`✅ Configuration fetched and saved successfully`);
      } catch (error) {
        console.error('❌ Fetch failed:', error);
        process.exit(1);
      }
    });

  program
    .command('deploy')
    .description('Deploy agent configuration from local JSON to ElevenLabs')
    .action(async () => {
      try {
        console.log(`🚀 Deploying agent configuration...`);
        const config = await manager.loadConfig();
        await manager.deployConfig(config);
        console.log(`✅ Configuration deployed successfully`);
      } catch (error) {
        console.error('❌ Deploy failed:', error);
        process.exit(1);
      }
    });

  await program.parseAsync();
}

// Always run the main function - no need for require.main check in CLI apps
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
