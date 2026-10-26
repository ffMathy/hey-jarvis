---
paths:
  - "elevenlabs/**"
---

# File Structure

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

```
elevenlabs/
├── src/
│   ├── main.ts                      # Main entry point for CLI operations
│   ├── agent-assets.ts              # Splits the config into the files below, and joins it back
│   └── assets/
│       ├── agent-config.json        # ElevenLabs agent configuration, naming its tools
│       ├── agent-prompt.md          # Agent personality and behavior prompt
│       └── tools/
│           ├── <name>.json          # One tool's settings
│           └── <name>.md            # That tool's description
├── tests/
│   ├── specs/                       # Agent behavior specification tests
│   ├── utils/                       # Conversation framework, tunnel, MCP helpers
│   └── README.md                    # How the tests are wired together
├── package.json                     # Project scripts, run through Turborepo
└── op.env                           # 1Password environment variable references
```
