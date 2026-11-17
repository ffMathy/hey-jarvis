---
paths:
  - "mcp/**"
---

# Current Agents

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Weather Agent
Provides intelligent weather information and forecasting capabilities:
- **4 OpenWeatherMap tools**: Current weather and 5-day forecasts by city name or GPS coordinates
- **Google Gemini model**: Uses `gemini-2.0-flash-exp` for natural language processing
- **Smart defaults**: Automatically assumes Aarhus, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction
- **Persistent memory**: Maintains conversation context with LibSQLStore
- **Scheduled monitoring**: Hourly weather checks with automatic memory updates

**Converted from n8n**: This agent replicates the exact functionality of the original n8n Weather Agent workflow, including the same system message, tools, and behavior patterns.

## Cooking Agent
Provides cooking, recipe search and meal planning capabilities:
- **5 Valdemarsro tools**: Recipe search, get by ID, the compact catalogue, get all recipes, and search filters
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Danish recipe focus**: Specialized for Danish cuisine from Valdemarsro website
- **General purpose**: Handles recipe search, information retrieval, and general cooking questions
- **Meal planning**: Hands meal plans to `generateMealPlanWorkflow`, whose specialized agents pick, schedule and format the week's dinners
- **The baby**: Suggests and plans dinners the household's baby can share at its age, following the Danish Health Authority's "Mad til små" (see [The Baby's Share of the Dinner](mcp-cooking-baby-food.md))
- **The household's dinner conventions**: Read from Knowledge (`conventions:home#cooking`) on every request, by it and by the meal plan's recipe selector; a lasting dinner convention sir states becomes a note there (see [The Household's Dinner Conventions](mcp-cooking-dinner-conventions.md))

## Split into its own rules

- [The Baby's Share of the Dinner](mcp-cooking-baby-food.md)
- [The Household's Dinner Conventions](mcp-cooking-dinner-conventions.md)
- [Shopping List Agent](mcp-shopping-list-agent.md)
- [Notification Agent](mcp-notification-agent.md)
- [Presence Vertical (Shortcuts Only)](mcp-presence-vertical-shortcuts-only.md)
- [Visualize Vertical (Shortcuts)](mcp-visualize-vertical-shortcuts.md)
- [Vision Vertical](mcp-vision-vertical.md)
- [Phone Vertical](mcp-phone-vertical.md)
- [Coding Agent](mcp-coding-agent.md)
- [Commute Agent](mcp-commute-agent.md)
- [Reflection Agent](mcp-reflection-agent.md)
- [Routing Planner Agent](mcp-routing-planner-agent.md)
