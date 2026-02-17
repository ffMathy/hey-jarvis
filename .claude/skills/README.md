# GitHub Copilot Agent Skills

This directory contains specialized skills for GitHub Copilot agents working on the Hey Jarvis project. Skills are automatically loaded by Copilot when relevant to the task at hand.

## What are Agent Skills?

Agent Skills are folders containing instructions that teach GitHub Copilot how to perform specialized tasks in a specific, repeatable way. When Copilot determines a skill is relevant to your task, it loads the instructions and follows them.

Learn more: [GitHub Copilot Agent Skills Documentation](https://docs.github.com/copilot/concepts/agents/about-agent-skills)

## Available Skills

### Development Workflow
- **[nx-monorepo-commands](./nx-monorepo-commands/SKILL.md)** - Using NX commands in the monorepo
- **[research-before-implementation](./research-before-implementation/SKILL.md)** - Mandatory research protocol
- **[boy-scout-rule](./boy-scout-rule/SKILL.md)** - Always leave code better than you found it

### Code Quality
- **[typescript-type-safety](./typescript-type-safety/SKILL.md)** - TypeScript type safety guidelines
- **[clean-code](./clean-code/SKILL.md)** - Variable naming and YAGNI principle
- **[conventional-commits](./conventional-commits/SKILL.md)** - Commit message standards
- **[use-npm-packages](./use-npm-packages/SKILL.md)** - Prefer npm packages over custom code

### Mastra Framework
- **[mastra-agent-creation](./mastra-agent-creation/SKILL.md)** - Creating new Mastra agents
- **[mastra-tool-creation](./mastra-tool-creation/SKILL.md)** - Creating new Mastra tools
- **[mastra-workflow-creation](./mastra-workflow-creation/SKILL.md)** - Creating workflows and steps
- **[mastra-vertical-organization](./mastra-vertical-organization/SKILL.md)** - Organizing code by business vertical

### Integration & Testing
- **[github-mcp-tools-usage](./github-mcp-tools-usage/SKILL.md)** - Using GitHub MCP tools
- **[testing](./testing/SKILL.md)** - Comprehensive testing requirements and workflow

## How Copilot Uses Skills

When you work on a task, Copilot:
1. Analyzes your prompt and the task context
2. Determines which skills are relevant based on their descriptions
3. Loads the relevant skill instructions into its context
4. Follows the instructions, patterns, and examples in the skill

## Skill Format

Each skill must:
- Be in its own directory (e.g., `.github/skills/my-skill/`)
- Contain a `SKILL.md` file
- Have YAML frontmatter with `name` and `description`
- Provide clear, actionable instructions

Example structure:
```
.github/skills/
└── my-skill/
    └── SKILL.md
```

Example `SKILL.md`:
```markdown
---
name: my-skill
description: When and why this skill should be used
---

# My Skill

Instructions for performing this specialized task...
```

## When Skills are Loaded

Skills are loaded automatically when Copilot detects relevance. You can also explicitly reference skills in your prompts:

```
"Create a new Mastra agent following the mastra-agent-creation skill"
```

## Maintenance

When updating skills:
1. Keep instructions focused and actionable
2. Include clear examples of correct vs incorrect patterns
3. Update the description if the skill's purpose changes
4. Test that Copilot picks up and follows the instructions

## Contributing

When adding new skills:
1. Extract repeatable, specialized knowledge from AGENTS.md files
2. Focus on "how-to" guidance, not general information
3. Keep each skill focused on one specific task or pattern
4. Use clear, imperative language
5. Include examples showing correct usage

## typescript-type-safety.md
**CRITICAL**: Never use `as any` casts. This document explains why and provides proper alternatives.
