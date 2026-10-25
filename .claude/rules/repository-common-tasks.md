# Common Tasks

> Part of [Hey Jarvis Repository](repository.md).

## Adding a New Mastra Agent

1. Create a new vertical in `mcp/mastra/verticals/<name>/`
2. Add `agent.ts`, `tools.ts`, `workflows.ts`, and `index.ts`
3. Export from `mcp/mastra/verticals/index.ts`
4. Register in `mcp/mastra/index.ts`
5. Document it in a rule of its own, `mcp-<vertical>-vertical.md`, scoped to `mcp/**` and linked from [`mcp-current-agents.md`](mcp-current-agents.md)

## Adding a New Tool

1. Create tool in appropriate vertical's `tools.ts`
2. Use `createTool()` factory function
3. Use camelCase for tool IDs, identical to the variable name and the export key
4. Export in the vertical's `index.ts`

## Running the Development Server

```bash
bunx turbo serve --filter=mcp
# Access playground at http://localhost:4111/agents
```

## Building for Production

```bash
bunx turbo build --filter=mcp
```
