---
paths:
  - "mcp/**"
---

# Tool ID Naming Conventions

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

**CRITICAL**: A tool's id, its variable name and its export key must be the same camelCase
word. See the [`mastra-tools`](mastra-tools.md) rule, which is the
authority on this.

## ✅ CORRECT Examples:
- `getCurrentWeather` ✅
- `findProductInCatalog` ✅
- `setProductBasketQuantity` ✅
- `getAllDevices` ✅
- `listRecentFailures` ✅

## ❌ INCORRECT Examples:
- `get-current-weather` ❌ (kebab-case)
- `get_current_weather` ❌ (snake_case)
- `GetCurrentWeather` ❌ (PascalCase)
- `get current weather` ❌ (spaces)
- id `getCurrentWeather` exported as `fetchWeather` ❌ (the three must match)

## 🎯 REASONING:
- **Mastra publishes the export keys.** `/api/tools` turns the keys of the object you
  spread into `tools` into the tool names callers see, so an id that disagrees with its
  key is a tool nobody can invoke by the name it reports.
- **Consistency**: every vertical follows this, so a tool can be found by grepping its id.

## ⚠️ This applies to tools, not to workflow steps
A **step** id stays kebab-case — `store-preferences`, `format-final-output`, and the ~70
others across the verticals — including a `createToolStep` wrapper, which is a step rather
than a tool. A **workflow** id is camelCase, matching the key it is registered under in
`mastra/index.ts`. Only tool ids are covered here.

This document previously said every tool id was kebab-case, which never matched the code:
only the `api` vertical's four token-usage tools were ever written that way, and every
other vertical — weather, calendar, coding, commute, cooking, email, IoT, notification,
phone, shopping, reflection — uses camelCase.
