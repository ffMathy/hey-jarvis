# Core Development Principles

> Part of [Hey Jarvis Repository](repository.md).

**See these rules for detailed guidance:**

- [`no-agents-md`](no-agents-md.md) - No AGENTS.md files; one topic per rule, scoped to its directory
- [`clean-code`](clean-code.md) - Variable naming, YAGNI, DRY, KISS, and ETC
- [`solid`](solid.md) - The five SOLID principles of object-oriented design
- [`no-hacks`](no-hacks.md) - Fix root causes; never paper over a problem
- [`code-smells`](code-smells.md) - The code smell catalog, and the refactorings that cure each smell
- [`refactoring`](refactoring.md) - How and when to refactor, and the refactoring technique catalog
- [`design-patterns`](design-patterns.md) - The creational, structural and behavioral design patterns, and when not to use them
- [`typescript`](typescript.md) - Type safety guidelines (prefer inference over casts)
- [`mastra`](mastra.md) - Factories, vertical organization, and type safety, plus [`mastra-agents`](mastra-agents.md), [`mastra-tools`](mastra-tools.md), and [`mastra-workflows`](mastra-workflows.md)
- [`use-npm-packages`](use-npm-packages.md) - Prefer existing libraries
- [`boy-scout-rule`](boy-scout-rule.md) - Leave code better than you found it
- [`conventional-commits`](conventional-commits.md) - Commit message and pull request title standards
- [`github-mcp-tools`](github-mcp-tools.md) - Use the GitHub MCP tools, never `curl` or `gh`
- [`security`](security.md) - Never read or print environment variable values
- [`supply-chain-security`](supply-chain-security.md) - Bun only, pinned versions, no install scripts, and [`github-actions-security`](github-actions-security.md) for pinned Actions
- [`releases`](releases.md) - Every push to `main` is a release
- [`1password`](1password.md) - Signing in to the vault that holds every secret
- [`terminal-sessions`](terminal-sessions.md) - Reuse terminal sessions
- [`parallel-task-execution`](parallel-task-execution.md) - Run independent steps as parallel background tasks
- [`turbo-commands`](turbo-commands.md) - Always run tasks through Turborepo
- [`validation`](validation.md) - When and how to run tests, linting, and builds
