# ElevenLabs Agent CLI# ElevenLabs Agent Deployer



A simple command-line tool for deploying and managing a single ElevenLabs conversational AI agent directly from code, eliminating the need for manual UI setup.Programmatic deployment and configuration management for ElevenLabs conversational agents, eliminating the need for manual UI configuration.



## Features## Overview



- **Single Agent Focus**: Manage one agent via environment configurationThis Node.js application provides a complete toolkit for deploying and managing ElevenLabs conversational agents through code rather than the web UI. It features both a REST API server and CLI tools for seamless agent deployment workflows.

- **CLI Interface**: Simple command-line operations for agent management

- **Environment Driven**: Configuration through environment variables only## Features

- **TypeScript**: Full type safety and modern development experience

- **Docker Support**: Containerized deployment ready- **🚀 Programmatic Deployment**: Deploy agents entirely through code/API calls

- **💾 Configuration Management**: Save, load, and sync agent configurations as files

## Quick Start- **🔄 Bidirectional Sync**: Sync configurations between ElevenLabs and local files

- **📡 REST API**: HTTP endpoints for integration with CI/CD and other tools

### Prerequisites- **⚡ CLI Tools**: Command-line interface for quick deployments

- **🏠 Jarvis Integration**: Pre-configured for Hey Jarvis ecosystem

- Node.js 18+ and npm

- ElevenLabs API key## Project Structure

- NX workspace (for development)

```

### Installationelevenlabs/

├── src/

```bash│   ├── main.ts                    # REST API server

# Install dependencies│   ├── cli.ts                     # CLI application

npm install│   └── services/

│       ├── elevenlabs-manager.ts  # ElevenLabs API client

# Set up environment variables│       ├── config-manager.ts      # Configuration file management

cp .env.example .env│       └── agent-deployer.ts      # High-level deployment logic

# Edit .env with your ElevenLabs API key and agent ID├── config/

```│   └── agents/                    # Local agent configurations (auto-created)

├── prompt.txt                     # Jarvis agent prompt template

### Environment Configuration└── project.json                   # NX project configuration

```

```bash

# Required## Quick Start

ELEVENLABS_API_KEY=your_api_key_here

ELEVENLABS_AGENT_ID=your_agent_id_here### 1. Environment Setup



# Optional```bash

ELEVENLABS_BASE_URL=https://api.elevenlabs.io# Required: ElevenLabs API key

```export ELEVENLABS_API_KEY="your-api-key-here"



## Usage# Optional: Default agent ID

export ELEVENLABS_AGENT_ID="your-agent-id"

### CLI Commands```



Build and run the CLI:### 2. Deploy via CLI



```bash```bash

# Build first# Deploy agent (creates/updates + saves config locally)

nx build elevenlabsnpx nx cli elevenlabs deploy my-agent-123



# Fetch agent information# Save existing agent config from ElevenLabs to file

node dist/elevenlabs/main.js fetchnpx nx cli elevenlabs save my-agent-123



# Deploy agent configuration# List local configurations

node dist/elevenlabs/main.js deploynpx nx cli elevenlabs list



# Get help# Show deployment status

node dist/elevenlabs/main.js --helpnpx nx cli elevenlabs status my-agent-123

``````



### Direct NX Usage### 3. Deploy via API Server



```bash```bash

# Run directly with NX# Start the API server

nx start elevenlabs fetchnpx nx serve elevenlabs

nx start elevenlabs deploy

```# Deploy agent via HTTP

curl -X POST http://localhost:8098/deploy \

### Docker Deployment  -H "Content-Type: application/json" \

  -d '{"agentId": "my-agent-123", "forceUpdate": false}'

```bash```

# Build and run with Docker

docker build -t elevenlabs-cli .## API Endpoints

docker run --env-file .env elevenlabs-cli fetch

```### Core Operations

- `POST /deploy` - Deploy agent (auto-detect or specify agentId)

## Development- `GET /agents/:id/status` - Get deployment status (local + remote)

- `GET /configs` - List all local configuration files

### Project Structure

### Configuration Management

```- `GET /agents/:id/config` - Get agent configuration from ElevenLabs

elevenlabs/- `POST /agents/:id/save-config` - Save agent config from ElevenLabs to file

├── src/- `POST /agents/:id/deploy-from-config` - Deploy agent from local config file

│   ├── main.ts              # CLI entry point and agent manager- `POST /agents/:id/sync` - Sync configuration from ElevenLabs to local

│   └── assets/              # Static assets

├── project.json             # NX project configuration### Discovery

├── tsconfig.app.json        # TypeScript configuration- `GET /agents` - List all agents from ElevenLabs

├── Dockerfile               # Container configuration- `GET /` - Health check and API documentation

└── README.md               # This file

```## CLI Commands



### Available Scripts```bash

# Deployment Operations

```bashnpx nx cli elevenlabs deploy [agentId]     # Deploy agent to ElevenLabs

# Build for productionnpx nx cli elevenlabs status [agentId]     # Show deployment status

nx build elevenlabs

# Configuration Management  

# Run CLInpx nx cli elevenlabs save [agentId]       # Save config from ElevenLabs to file

nx start elevenlabsnpx nx cli elevenlabs sync [agentId]       # Sync config from ElevenLabs



# Run tests# Discovery Operations

nx test elevenlabsnpx nx cli elevenlabs list                 # List local configuration files

npx nx cli elevenlabs agents               # List agents from ElevenLabs

# Lint codenpx nx cli elevenlabs                      # Show help

nx lint elevenlabs```

```

## Configuration Files

## Error Handling

Agent configurations are automatically saved as JSON files in `config/agents/`:

### Common Issues

```json

1. **Missing Environment Variables**: Ensure `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` are set{

2. **Invalid API Key**: Verify your ElevenLabs API key is valid and has sufficient permissions  "agent_id": "my-agent-123",

3. **Network Issues**: Check connectivity to ElevenLabs services  "name": "Jarvis Assistant",

4. **Agent Not Found**: Verify the agent ID exists and is accessible  "description": "AI assistant for home automation",

  "prompt": "You are Jarvis, an advanced AI assistant...",

### Debugging  "conversation_config": {

    "agent": {

The CLI provides clear error messages and validates environment configuration on startup.      "prompt": "You are Jarvis...",

      "first_message": "Hello! How can I help?",

## Contributing      "language": "en"

    },

1. Follow the existing code style and patterns    "llm": {

2. Keep the single-agent focus (YAGNI principle)      "provider": "openai",

3. Ensure Docker builds successfully      "model": "gpt-4",

4. Update documentation for any changes      "max_tokens": 1500,

      "temperature": 0.7

## License    }

  },

MIT License - see LICENSE file for details.  "_metadata": {
    "saved_at": "2024-01-01T12:00:00Z",
    "version": "1.0.0"
  }
}
```

## Development

### Running Locally

```bash
# Development server with auto-reload
npx nx dev elevenlabs

# Production build
npx nx build elevenlabs

# Run built CLI
npx nx cli elevenlabs --help
```

### Docker Deployment

```bash
# Build Docker image
npx nx docker:build elevenlabs

# Run container
docker run -e ELEVENLABS_API_KEY=your-key elevenlabs
```

## Integration with Hey Jarvis

This project automatically integrates with the Hey Jarvis ecosystem:

1. **Prompt Template**: Uses `prompt.txt` containing the full Jarvis personality and instructions
2. **Environment Variables**: Reads `ELEVENLABS_AGENT_ID` from devcontainer configuration
3. **MCP Integration**: Agents are pre-configured to work with Jarvis MCP server tools
4. **Home Assistant**: Ready for voice command processing through the addon

## Workflow Examples

### Initial Agent Setup
```bash
# 1. Create default config from prompt.txt
npx nx cli elevenlabs deploy new-agent-123

# 2. Verify deployment
npx nx cli elevenlabs status new-agent-123

# 3. Make manual adjustments in ElevenLabs UI if needed

# 4. Sync changes back to local config
npx nx cli elevenlabs sync new-agent-123
```

### CI/CD Integration
```bash
# Deploy agent in CI pipeline
curl -X POST "$DEPLOY_SERVER/deploy" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "'$AGENT_ID'", "forceUpdate": true}'
```

### Configuration Backup
```bash
# Backup all agent configurations
npx nx cli elevenlabs list
# Save each agent: npx nx cli elevenlabs save <agent-id>
```

## Troubleshooting

### Common Issues

1. **API Key Issues**
   ```bash
   # Verify API key is set
   echo $ELEVENLABS_API_KEY
   
   # Test connection
   npx nx cli elevenlabs agents
   ```

2. **Agent Not Found**
   ```bash
   # Check if agent exists
   npx nx cli elevenlabs status my-agent-123
   
   # List all available agents
   npx nx cli elevenlabs agents
   ```

3. **Configuration Conflicts**
   ```bash
   # Force update from ElevenLabs
   npx nx cli elevenlabs sync my-agent-123
   
   # Deploy with force update
   curl -X POST http://localhost:8098/deploy \
     -d '{"agentId": "my-agent-123", "forceUpdate": true}'
   ```

## Future Enhancements

- **Voice Model Management**: Deploy and manage voice clones
- **Tool Configuration**: Automated MCP tool registration
- **Batch Operations**: Deploy multiple agents simultaneously
- **Version Control**: Git-based configuration management
- **Testing Framework**: Automated agent conversation testing

## Contributing

This project follows the Hey Jarvis monorepo standards:
- Use NX commands: `npx nx [command] elevenlabs`
- Follow TypeScript best practices
- Update this README for new features
- Add proper error handling and logging