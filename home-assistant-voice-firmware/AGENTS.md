# Home Assistant Voice Firmware Agents

## Overview
This document describes the agents and automation capabilities for the Home Assistant Voice Firmware project in the Hey Jarvis monorepo.

## Project Description
A simple Hello World C++ application that demonstrates basic firmware structure and serves as a foundation for future voice processing and home automation integration.

## Key Features
- Simple C++ "Hello World" application
- Demonstrates basic class structure and execution flow
- Cross-platform compilation support
- Foundation for embedded systems and IoT device integration

## Agents & Automation
Currently implements:
- **HelloWorldApp**: A basic firmware agent that demonstrates greeting functionality
- Simple console output and execution flow
- C++ standard library utilization

## Future Capabilities
- Voice command processing and recognition
- Home Assistant integration for smart home control
- Real-time audio processing
- Device communication protocols
- Embedded systems deployment

## Hardware Integration
Designed to be compatible with:
- Raspberry Pi and similar SBCs
- ESP32/Arduino microcontrollers
- Voice processing hardware
- Home automation devices

## Usage
```bash
# Build the firmware
bunx nx build home-assistant-voice-firmware

# Run the firmware
bunx nx serve home-assistant-voice-firmware
```

## GitHub Integration

### GitHub MCP Tools Usage
**CRITICAL: Always use GitHub MCP tools** for repository operations:
- ✅ Use `mcp_github_github_list_releases` to check firmware releases
- ✅ Use `mcp_github_github_get_release_by_tag` for specific version info
- ✅ Use `mcp_github_github_list_tags` to see all available tags
- ✅ Use `mcp_github_github_create_branch` for new feature branches
- ❌ **NEVER use curl or manual API calls** for GitHub operations

**Example**: When checking if a firmware version exists:
```typescript
// ✅ CORRECT
await mcp_github_github_get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'home-assistant-voice-firmware-v0.2.2'
});

// ❌ INCORRECT
exec('curl https://api.github.com/repos/...');
```

## Development Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve home-assistant-voice-firmware` instead of running dev directly
- ✅ Use `nx build home-assistant-voice-firmware` instead of running build directly
- ✅ Use `nx test home-assistant-voice-firmware` instead of running test directly
- ✅ Use `nx lint home-assistant-voice-firmware` instead of running lint directly
- ❌ **NEVER use npm commands** in this Bun-powered monorepo
- ❌ **NEVER run commands directly** - always use NX for project commands

### 1Password Authentication
If this project uses 1Password CLI for environment variables:
1. **Sign in**: `eval $(op signin)` - **CRITICAL: Always run this command when you get a 1Password authentication error or non-zero exit code from op commands**
2. **Verify**: `op whoami`

**Important**: 
- If any command using 1Password fails with "no active session found" or similar errors, immediately run `eval $(op signin)` to re-authenticate before continuing.
- **After running `eval $(op signin)`, always assume it succeeded regardless of what output it returns.** It typically returns no output when successful.

### Terminal Session Management
**CRITICAL: Always reuse existing terminal sessions** when running commands:
- Check `get_terminal_output` to see what terminals are available
- Reuse the same terminal ID for related commands instead of creating new terminals
- This maintains context, environment variables, and reduces resource usage

## Development Guidelines

### Core Development Principles

#### 🎯 **YAGNI (You Aren't Gonna Need It)**
Apply YAGNI principle to firmware and embedded systems development:
- **Hardware Abstraction**: Only abstract hardware interfaces when supporting multiple platforms
- **Protocol Support**: Don't implement communication protocols until they're needed
- **Memory Management**: Keep memory allocation simple until optimization is required
- **Feature Flags**: Avoid configuration options for features that aren't implemented yet
- **Libraries**: Don't include libraries until they solve a specific problem

## Development
The firmware is built using C++17 and follows NX monorepo conventions. All source code is located in the `src/` directory. The build system uses g++ for compilation.

## Commit Message Standards

**CRITICAL: ALWAYS follow Conventional Commits** for all commit messages:

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Required Components
- **type**: Category of the change (REQUIRED)
- **scope**: Component affected (optional but recommended)
- **subject**: Brief description (REQUIRED, lowercase, no period)
- **body**: Detailed explanation (optional)
- **footer**: Breaking changes, issue references (optional)

### Commit Types
- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation only changes
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or refactoring tests
- **chore**: Maintenance tasks, dependency updates
- **build**: Build system or external dependency changes
- **ci**: CI configuration changes

### Examples
```bash
# Feature addition
feat(firmware): add voice recognition module

# Bug fix with scope
fix(audio): correct sample rate configuration

# Documentation update
docs(firmware): update hardware compatibility list

# Breaking change
feat(api)!: change communication protocol

BREAKING CHANGE: Protocol now uses binary format instead of JSON
```

### Scope Guidelines
Use project names or component names:
- `firmware`, `audio`, `hardware`
- `voice`, `processing`
- `build`, `ci`, `deps`

### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Use body to explain "what" and "why" vs. "how"
- Reference issues in footer: `Closes #123`