# ElevenLabs Agent Deployer

A simple command-line tool for deploying and managing a single ElevenLabs conversational AI agent directly from code, eliminating the need for manual UI setup.

> **Note on ElevenLabs CLI**: The official [@elevenlabs/cli](https://github.com/elevenlabs/cli) provides similar functionality with a broader feature set. However, our custom implementation offers specific advantages for the Hey Jarvis project:
> - Simplified single-agent focus with environment-driven configuration
> - Custom prompt separation for better version control
> - Integrated security filtering for sensitive data
> - Seamless 1Password integration
> - No React/UI dependencies that could conflict in monorepo environments
>
> Users comfortable with the official CLI can use it alongside this tool - both use the same ElevenLabs SDK under the hood.

## Features

- **Single Agent Focus**: Manage one agent via environment configuration
- **CLI Interface**: Simple command-line operations for agent management  
- **Environment Driven**: Configuration through environment variables only
- **TypeScript**: Full type safety and modern development experience
- **1Password Integration**: Secure credential management
- **Security Filtering**: Sensitive data automatically filtered from persisted configs

## Quick Start

### Environment Setup

This project uses 1Password CLI for secure environment variable management:

```bash
# Required in your 1Password vault:
# HEY_JARVIS_ELEVENLABS_API_KEY - Your ElevenLabs API key
# HEY_JARVIS_ELEVENLABS_AGENT_ID - Target agent ID
# HEY_JARVIS_ELEVENLABS_VOICE_ID - Voice ID for the agent (optional)

# The .env file references these 1Password secret paths
# All nx commands automatically use 'op run' for secure access
```

### Deploy Agent Configuration

```bash
# Deploy current agent configuration to ElevenLabs
nx deploy elevenlabs

# Initialize/fetch current agent configuration from ElevenLabs  
nx init elevenlabs
```

## Project Structure

```
elevenlabs/
├── src/
│   ├── main.ts              # CLI entry point and agent manager
│   └── assets/              # Static assets
│       ├── agent-config.json  # ElevenLabs configuration (without prompt)
│       └── agent-prompt.md    # Jarvis personality prompt
├── project.json             # NX project configuration
├── tsconfig.app.json        # TypeScript configuration
├── .env                     # 1Password environment references
└── README.md               # This file
```

## Usage

The application automatically combines `agent-prompt.md` with `agent-config.json` for deployment:

- **agent-prompt.md**: Contains the Jarvis personality and instructions (6,161 bytes)
- **agent-config.json**: Contains ElevenLabs configuration without the prompt (5,845 bytes)

### Available Scripts

```bash
# Build for production
nx build elevenlabs

# Deploy agent configuration to ElevenLabs
nx deploy elevenlabs

# Initialize/fetch agent configuration from ElevenLabs
nx init elevenlabs

# Run tests
nx test elevenlabs

# Lint code
nx lint elevenlabs
```

## Development

### Running Locally

```bash
# Build the application
nx build elevenlabs

# Deploy with current configuration
nx deploy elevenlabs

# Initialize/fetch latest configuration from ElevenLabs
nx init elevenlabs
```

### Testing

**IMPORTANT**: The test target depends on the deploy target. This is intentional and required because:

- Tests validate agent behavior against the **deployed configuration** on ElevenLabs
- Tests use LLM-based evaluation to verify conversation quality and personality traits
- The agent must be deployed with the latest configuration before tests can validate its behavior

When you run `nx test elevenlabs`, it automatically:
1. Deploys the current agent configuration to ElevenLabs (`nx deploy elevenlabs`)
2. Runs tests that interact with the live deployed agent via WebSocket
3. Evaluates responses using Gemini models to verify personality, tone, and correctness

**Note**: Do not remove the `deploy` dependency from the test target, as this will cause tests to run against stale configurations.

### Agent Configuration

The agent configuration is split into two files for better maintainability:

1. **agent-config.json**: Technical ElevenLabs configuration (sensitive data filtered)
2. **agent-prompt.md**: Jarvis personality prompt in Markdown format

When deploying, the CLI automatically:
- Combines these files and updates the agent on ElevenLabs
- Injects `HEY_JARVIS_ELEVENLABS_AGENT_ID` and `HEY_JARVIS_ELEVENLABS_VOICE_ID` from environment variables
- Filters sensitive data (phone numbers, access info, metadata, voice_id, agent_id) when saving configurations

## Security Features

The application implements several security measures:

### Sensitive Data Filtering
When fetching configurations from ElevenLabs, the following sensitive data is automatically removed before saving to disk:
- `phone_numbers` - Contact information
- `accessInfo` - Authentication and access data  
- `_metadata` - Internal metadata
- `voice_id` - Voice identifiers (injected from environment on deploy)
- `agent_id` - Agent identifiers (injected from environment on deploy)

### Environment Variable Injection
On deployment, the following environment variables are automatically injected:
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` → `config.agent_id`
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` → `config.conversation_config.agent.voice_id`

This ensures sensitive IDs are never persisted to disk but are available during deployment.

## Integration with Hey Jarvis

This project is part of the Hey Jarvis ecosystem:

1. **Prompt Template**: Uses `agent-prompt.md` containing the full Jarvis personality
2. **Environment Variables**: Secure 1Password CLI integration
3. **NX Monorepo**: Follows Hey Jarvis development standards
4. **YAGNI Principles**: Simplified to essential functionality only

## Troubleshooting

### Common Issues

1. **1Password CLI Issues**
   ```bash
   # Sign in to 1Password CLI
   op signin
   
   # Verify your vault contains the required secrets
   op item list
   ```

2. **Agent Not Found**
   ```bash
   # Check if agent exists by initializing
   nx init elevenlabs
   ```

3. **API Key Problems**
   ```bash
   # Verify 1Password CLI can access your secrets
   op run --env-file=".env" -- env | grep ELEVENLABS
   ```

## Contributing

This project follows the Hey Jarvis monorepo standards:
- Use NX commands: `nx [command] elevenlabs`
- Follow TypeScript best practices
- Apply YAGNI principles - only add what's needed
- Update this README for any changes

## License

MIT License - see LICENSE file for details.
