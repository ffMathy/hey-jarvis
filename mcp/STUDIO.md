# Mastra Studio UI

This document describes how to access and use the Mastra Studio UI with the Hey Jarvis MCP server.

## What is Mastra Studio?

Mastra Studio is an interactive web-based UI for building, testing, and debugging Mastra agents and workflows. It provides:

- **Agents Playground**: Test agents interactively with a chat interface
- **Workflows Visualization**: View and execute workflows with real-time step tracking
- **Tools Explorer**: Test tools in isolation
- **MCP Servers**: View and test MCP server tools
- **Observability**: View traces and logs for all operations
- **Scorers**: Monitor and evaluate agent performance

## Architecture

The Hey Jarvis deployment runs three services:

1. **Mastra Server** (Port 4111): REST API for agents, workflows, and tools
2. **MCP Server** (Port 4112): Model Context Protocol server
3. **Mastra Studio UI** (Port 3000): Interactive web interface

The Studio UI connects to the Mastra Server API to provide an interactive development experience.

## Accessing the Studio

### Docker (Production)

When running the Docker container, the Studio UI is available at:

```
http://localhost:3000
```

The Mastra Server API and Swagger UI are at:

```
http://localhost:4111
http://localhost:4111/swagger-ui
```

### Local Development

To run the Studio UI locally for development:

1. **Start the Mastra Server** (Terminal 1):
   ```bash
   bunx nx serve mcp
   ```
   This starts the API server on port 4111.

2. **Start the Studio UI** (Terminal 2):
   ```bash
   bunx nx serve:studio mcp
   ```
   This starts the Studio UI on port 3000.

3. **Access the UI**:
   Open your browser to http://localhost:3000

## Testing

### Running E2E Tests

Playwright e2e tests verify the Studio UI functionality:

```bash
# Start the services first
bunx nx serve mcp          # Terminal 1
bunx nx serve:studio mcp   # Terminal 2

# Run the tests (Terminal 3)
cd mcp
bunx playwright test

# View the test report
bunx playwright show-report
```

### Manual Testing

1. **Verify Agents**:
   - Navigate to http://localhost:3000
   - Click on "Agents" in the navigation
   - Select an agent and try chatting with it

2. **Verify Workflows**:
   - Navigate to "Workflows"
   - Select a workflow
   - Click "Run" and provide input
   - Watch the workflow execute step-by-step

3. **Verify Tools**:
   - Navigate to "Tools"
   - Select a tool
   - Provide input and execute
   - Verify the output

## Features

### Agent Testing
Test your agents interactively:
- Chat interface with message history
- Model parameter controls (temperature, top-p, etc.)
- Tool execution visibility
- Trace and log inspection

### Workflow Execution
Visual workflow execution:
- Graph visualization of workflow steps
- Real-time execution progress
- Step input/output inspection
- Error handling and retry logic

### Observability
Monitor and debug:
- OpenTelemetry traces for all operations
- Detailed logs with filtering
- Performance metrics
- Token usage tracking

### Scorers & Evaluations
Evaluate agent performance:
- Run scorers on agent outputs
- View scoring results and reasoning
- Compare performance across runs
- Track metrics over time

## Configuration

### Environment Variables

The Studio UI can be configured with these environment variables:

- `MASTRA_STUDIO_PORT`: Port for Studio UI (default: 3000)
- `MASTRA_SERVER_PORT`: Port for Mastra Server API (default: 4111)
- `MCP_SERVER_PORT`: Port for MCP Server (default: 4112)

### Docker Compose

Example docker-compose.yml configuration:

```yaml
version: '3.8'
services:
  hey-jarvis-mcp:
    build: ./mcp
    ports:
      - "4111:4111"  # Mastra Server API
      - "4112:4112"  # MCP Server
      - "3000:3000"  # Studio UI
    environment:
      - MASTRA_SERVER_PORT=4111
      - MCP_SERVER_PORT=4112
      - MASTRA_STUDIO_PORT=3000
```

## Troubleshooting

### Studio UI Not Loading

1. **Check if services are running**:
   ```bash
   curl http://localhost:4111/health  # Mastra Server
   curl http://localhost:3000         # Studio UI
   ```

2. **Check Docker logs**:
   ```bash
   docker logs <container-id>
   ```

3. **Verify ports are not in use**:
   ```bash
   netstat -tuln | grep -E "4111|3000|4112"
   ```

### API Connection Errors

If the Studio UI shows "Cannot connect to API":

1. Verify the Mastra Server is running on port 4111
2. Check that the `--server-host` and `--server-port` flags are correct
3. Look for CORS errors in the browser console

### Missing Agents or Workflows

If agents or workflows don't appear in the UI:

1. Verify they're registered in `mcp/mastra/index.ts`
2. Check the server logs for initialization errors
3. Restart both the server and Studio UI

## Development

### Adding New Components

When adding new agents, workflows, or tools:

1. Add them to the appropriate directory in `mcp/mastra/`
2. Export them from `mcp/mastra/index.ts`
3. Restart the Mastra Server
4. Refresh the Studio UI to see the changes

### Modifying the Studio UI

The Studio UI is served by the `mastra studio` CLI command. To modify it:

1. Check the Mastra Studio source code in the `mastra` npm package
2. Contribute changes upstream to the Mastra project
3. Update the `mastra` version in package.json

## Resources

- [Mastra Documentation](https://mastra.ai/docs)
- [Mastra Studio Guide](https://mastra.ai/docs/getting-started/studio)
- [Mastra CLI Reference](https://mastra.ai/reference/cli/mastra)
- [Hey Jarvis MCP AGENTS.md](./AGENTS.md)
