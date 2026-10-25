---
paths:
  - "mcp/**"
---

# File Creation Policy

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

**CRITICAL**: When working on this project:

## ❌ ABSOLUTELY PROHIBITED FILES:
- **NEVER create ANY .md files** outside `.claude/rules/` and `.claude/skills/`, and never an AGENTS.md or CLAUDE.md - Not README.md, not GUIDE.md, not TESTING.md, not anything
- **NO markdown files of any kind** (README, GUIDE, DOCS, SHOPPING_README, TESTING, IMPLEMENTATION_SUMMARY, etc.)
- **NO documentation artifacts** (ANALYSIS.md, COMPARISON.md, ARCHITECTURE.md, etc.)
- **NO explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md, etc.)
- **NO example or demo scripts** unless explicitly requested
- **NO test files or testing artifacts** outside the standard test directory structure
- **NO configuration files** not directly required for functionality

## ✅ ALLOWED FILE CREATION:
- **Core functionality files**: agents, tools, workflows in their respective directories
- **Package configuration**: Only when required for new dependencies
- **Test scripts**: Only .js/.ts files in appropriate test directories when needed

## 📝 DOCUMENTATION UPDATES:
- **UPDATE the mcp rules** (`.claude/rules/mcp-*.md`, one topic each, indexed from `.claude/rules/mcp.md`) instead of creating new documentation
- **Add inline comments** in code for complex logic explanations
- **Update existing configuration files** when adding new features
- **Use the Mastra playground** for testing and examples instead of creating files

## 🎯 REASONING:
This project follows a strict "lean documentation" approach because:
- **The mcp rules are the single source of truth** for all project documentation
- **NO OTHER .md FILES ARE PERMITTED** - everything goes in the mcp rules, `.claude/rules/mcp-*.md`
- **Scattered documentation** creates maintenance overhead and confusion
- **The Mastra playground** provides interactive testing without file creation
- **Inline comments** are more maintainable than separate documentation files
- **Multiple README files** violate the monorepo structure and TURBO conventions

**If you feel documentation is needed, ALWAYS update the mcp rule for that topic, or add a rule for a new topic, instead of creating other files. DO NOT CREATE ANY OTHER .md FILES UNDER ANY CIRCUMSTANCES.**
