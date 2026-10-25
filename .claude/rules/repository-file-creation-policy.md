# File Creation Policy

> Part of [Hey Jarvis Repository](repository.md).

## ❌ PROHIBITED FILES:

- **ANY new .md files** outside `.claude/rules/` and `.claude/skills/` — and **never** an `AGENTS.md` or `CLAUDE.md`
- **ANY documentation artifacts** (README, GUIDE, DOCS, etc.)
- **Example or demo scripts** unless explicitly requested
- **Test files** outside standard test directory structure

## ✅ ALLOWED:

- Core functionality files (agents, tools, workflows)
- Package configuration when required for new dependencies
- Test scripts in appropriate test directories

## 📝 DOCUMENTATION:

- **UPDATE the existing rules** in `.claude/rules/` (a project's notes are `.claude/rules/<project>-<topic>.md`, one topic each, indexed from `.claude/rules/<project>.md`) instead of creating new documentation
- Add inline comments for complex logic
- Use the Mastra playground for testing and examples
