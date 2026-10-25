# Hey Jarvis Repository

The shared conventions every project in this monorepo follows.

## Its rules

Each topic is a rule of its own (see [Rules, Not AGENTS.md](no-agents-md.md)):

- [Rules, Not AGENTS.md](no-agents-md.md)
- [Parallel Task Execution](parallel-task-execution.md)
- [Core Development Principles](repository-core-development-principles.md)
- [Web Search and Information Retrieval](repository-web-search-and-information-retrieval.md)
- [File Creation Policy](repository-file-creation-policy.md)
- [Common Tasks](repository-common-tasks.md)

## Technology Stack

- **Runtime**: Bun (not Node.js)
- **Package Manager**: Bun only — `npm`/`npx`/`yarn`/`pnpm` are rejected (see [Supply Chain Security](supply-chain-security.md))
- **Build System**: Turborepo monorepo
- **Language**: TypeScript (strict mode)
- **AI Framework**: Mastra (V1)
- **LLM Provider**: Google Gemini (gemini-flash-latest)
- **Linting**: Biome
- **Testing**: `bun test`

## Repository Structure

This is a Turborepo monorepo containing intelligent voice assistant components. Each project's notes are a rule scoped to that project's directory; paths inside each are relative to it unless they say otherwise. When a change in one project depends on another (the apps on `hologram`, the apps on `mcp`'s server), read that project's rule too.

| Project                           | Description                                       | Rule |
| --------------------------------- | ------------------------------------------------- | ---- |
| **mcp**                           | Mastra AI-powered Model Context Protocol server: agents, tools, workflows, and vertical organization | [`mcp.md`](mcp.md) |
| **elevenlabs**                    | ElevenLabs voice interface integration, and its testing guidelines | [`elevenlabs.md`](elevenlabs.md) |
| **hologram**                      | Jarvis's sphere, voice tracker and conversation, shared by every app that is him: why nothing in it imports a value, and how it is tested | [`hologram.md`](hologram.md) |
| **mobile**                        | Expo app that is the phone's default assistant, and what makes Android accept it as one | [`mobile.md`](mobile.md) |
| **watch**                         | Expo app that is the watch's assistant, and how to try it as a Pixel Watch's assistant | [`watch.md`](watch.md) |
| **vr**                            | WebXR app that puts Jarvis in your room on a Meta Quest: the wake word, where he stands, the conversation and the 3D hologram, the emulated headset its tests run in, and the wake-word models' licence | [`vr.md`](vr.md) |
| **home-assistant-voice-firmware** | ESPHome firmware for voice hardware               | [`home-assistant-voice-firmware.md`](home-assistant-voice-firmware.md) |

## Pull Request Standards

**Pull request titles MUST follow Conventional Commits format** (same as commit messages).

Format: `<type>(<scope>): <subject>`

## Contributing

**See these rules for detailed development guidelines:**

- [`mastra`](mastra.md) - Factories, vertical organization, and type safety
- [`mastra-agents`](mastra-agents.md), [`mastra-tools`](mastra-tools.md), [`mastra-workflows`](mastra-workflows.md) - Per-file-type conventions

All contributions should:

- Follow TypeScript best practices
- Use the Hey Jarvis factory patterns
- Include proper testing
- Update the relevant project rule in `.claude/rules/`

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), use repository-approved generators and workspace conventions first.
