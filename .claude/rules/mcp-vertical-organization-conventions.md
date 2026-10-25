---
paths:
  - "mcp/**"
---

# Vertical Organization Conventions

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## 📋 **Core Principles**
This project uses **vertical organization** where code is grouped by business domain rather than technical layer. Follow these conventions for all future development:

## ✅ **Validation Checklist**
Before considering a vertical complete:

- [ ] Directory follows naming conventions
- [ ] All files use proper naming patterns  
- [ ] Exports are properly structured
- [ ] Agent responsibilities are clear and focused
- [ ] Tool IDs are camelCase, identical to the variable and the export key
- [ ] Workflows match business processes
- [ ] Main index files are updated
- [ ] Build passes: `bunx turbo build --filter=mcp`
- [ ] Documentation updated in this rule (`.claude/rules/mcp.md`)

## 🎯 **When to Create Sub-Verticals**
Create sub-verticals when:
- **>4 specialized agents** in one vertical
- **Multiple distinct workflows** that share some but not all tools
- **Complex business processes** that have sub-processes
- **Clear logical separation** within the vertical

**Example**: `cooking/meal-planning/` exists because meal planning has 3 specialized agents and complex workflows, while general recipe search is simpler.

## Split into its own rules

- [🏗️ **Directory Structure Rules**](mcp-directory-structure-rules.md)
- [🎯 **Naming Conventions**](mcp-naming-conventions.md)
- [📦 **Export Patterns**](mcp-export-patterns.md)
- [🔧 **Implementation Guidelines**](mcp-implementation-guidelines.md)
- [🚀 **Step-by-Step: Adding a New Vertical**](mcp-step-by-step-adding-a-new-vertical.md)
