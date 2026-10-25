---
paths:
  - "mcp/**"
---

# Architecture Benefits

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Vertical Organization
- **Business Domain Alignment**: Code is organized by business verticals (weather, shopping, cooking) rather than technical layers
- **High Cohesion**: Related agents, tools, and workflows are co-located for better maintainability
- **Sub-vertical Support**: Complex verticals like cooking can have sub-folders (meal-planning) for specialized flows
- **Clear Ownership**: Each vertical has its own focused scope and responsibilities

## Type Safety
- Full TypeScript support with runtime validation
- Zod schemas for structured data
- Type-safe tool definitions and agent configurations

## Scalability
- Horizontal scaling with workflow distribution
- Memory-efficient agent state management
- Observability and performance monitoring
- Cloud deployment ready (Vercel, Cloudflare, AWS Lambda)

## Extensibility
- Modular agent and tool architecture
- Plugin-based workflow system
- Easy integration with external services
- Custom evaluation and scoring systems
