# Mastra Studio Implementation Summary

## Overview

This implementation adds the Mastra Studio UI to the Hey Jarvis MCP Docker deployment, providing an interactive web interface for testing and debugging agents, workflows, and tools.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Docker Container                            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Supervisord Process Manager               │  │
│  │                                                    │  │
│  │  ┌───────────────────────────────────────────┐   │  │
│  │  │  Mastra Server (Port 4111)                │   │  │
│  │  │  - REST API for agents/workflows/tools    │   │  │
│  │  │  - Health endpoint: /health               │   │  │
│  │  │  - Swagger UI: /swagger-ui                │   │  │
│  │  │  - Native compiled binary                 │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  │                      ▲                             │  │
│  │                      │ HTTP                        │  │
│  │  ┌───────────────────┴───────────────────────┐   │  │
│  │  │  Mastra Studio UI (Port 3000)             │   │  │
│  │  │  - Interactive web interface              │   │  │
│  │  │  - Agent testing & debugging              │   │  │
│  │  │  - Workflow visualization                 │   │  │
│  │  │  - Runs via `mastra studio` CLI           │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  │                                                    │  │
│  │  ┌───────────────────────────────────────────┐   │  │
│  │  │  MCP Server (Port 4112)                   │   │  │
│  │  │  - Model Context Protocol server          │   │  │
│  │  │  - Provides tools to MCP clients          │   │  │
│  │  │  - Native compiled binary                 │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  │                                                    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Exposed Ports
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   Port 4111         Port 3000         Port 4112
  Mastra API       Studio UI          MCP Server
```

## Key Components

### 1. Mastra Server (Port 4111)
- **Purpose**: REST API backend for agents, workflows, and tools
- **Technology**: Hono framework compiled to native binary
- **Endpoints**:
  - `GET /health` - Health check
  - `GET /swagger-ui` - API documentation
  - `POST /agents/:id/generate` - Agent text generation
  - `POST /agents/:id/stream` - Agent streaming
  - `POST /workflows/:id/execute` - Workflow execution
  - And many more...

### 2. Mastra Studio UI (Port 3000)
- **Purpose**: Interactive web interface for development and testing
- **Technology**: Web app served by `mastra studio` CLI command
- **Features**:
  - Agent chat interface
  - Workflow visualization
  - Tool testing
  - Observability traces
  - Performance scorers
- **Connection**: Connects to Mastra Server API on port 4111

### 3. MCP Server (Port 4112)
- **Purpose**: Model Context Protocol server for external integrations
- **Technology**: Native compiled binary
- **Use Cases**: IDE integrations, external tool access

## Implementation Details

### Docker Changes

**Dockerfile**:
- Changed from Alpine to Bun Alpine (required for `mastra studio` CLI)
- Added node_modules and mastra source files to production image
- Exposed port 3000 for Studio UI
- Kept API server and MCP server as compiled binaries for performance

**supervisord.conf**:
- Added `mastra-studio` program definition
- Configured to run `bun run mastra studio` with correct port and server settings
- Set priority to start after API server

**healthcheck.sh**:
- Added check for Studio UI on port 3000 (non-blocking warning if unavailable)
- Studio is optional and won't fail the container if it's not responding

### Development Workflow

**Local Development**:
```bash
# Terminal 1: Start API server
bunx nx serve mcp

# Terminal 2: Start Studio UI
bunx nx serve:studio mcp

# Terminal 3: Run tests
cd mcp && bunx playwright test
```

**Docker Development**:
```bash
# Build image
bunx nx build mcp
docker build -f mcp/Dockerfile -t hey-jarvis-mcp .

# Run container
docker run -p 4111:4111 -p 4112:4112 -p 3000:3000 \
  -e HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY=<key> \
  hey-jarvis-mcp

# Access Studio
open http://localhost:3000
```

## Testing

### Automated Tests (Playwright)
Location: `mcp/tests/e2e/mastra-studio.spec.ts`

Tests verify:
- Studio UI homepage loads
- Navigation to agents, workflows sections
- API connection status
- Swagger UI accessibility

Run with:
```bash
bunx playwright test
bunx playwright show-report
```

### Manual Testing Checklist

1. **Studio UI Access**:
   - [ ] Navigate to http://localhost:3000
   - [ ] Verify homepage loads without errors
   - [ ] Check browser console for errors

2. **Agent Testing**:
   - [ ] Click "Agents" in navigation
   - [ ] Select an agent
   - [ ] Send a test message
   - [ ] Verify response appears
   - [ ] Check traces in Observability

3. **Workflow Testing**:
   - [ ] Click "Workflows" in navigation
   - [ ] Select a workflow
   - [ ] Click "Run" and provide input
   - [ ] Watch execution progress
   - [ ] Verify workflow completes

4. **API Verification**:
   - [ ] Visit http://localhost:4111/health
   - [ ] Visit http://localhost:4111/swagger-ui
   - [ ] Test an endpoint from Swagger UI

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTRA_SERVER_PORT` | 4111 | Mastra API server port |
| `MCP_SERVER_PORT` | 4112 | MCP server port |
| `MASTRA_STUDIO_PORT` | 3000 | Studio UI port |

### Customization

To change ports, update:
1. Environment variables in Dockerfile/docker-compose
2. supervisord.conf service commands
3. healthcheck.sh port checks

## Troubleshooting

### Studio UI Shows "Cannot Connect"
- Verify Mastra Server is running: `curl http://localhost:4111/health`
- Check Docker logs: `docker logs <container-id>`
- Verify --server-host and --server-port in supervisord.conf

### Agents Don't Appear
- Check they're exported in `mcp/mastra/index.ts`
- Restart both API server and Studio UI
- Check server logs for initialization errors

### Port Conflicts
- Check if ports are already in use: `netstat -tuln | grep -E "4111|3000|4112"`
- Change ports via environment variables
- Update docker-compose port mappings

## Documentation

- **STUDIO.md**: Comprehensive Studio UI guide with features, usage, and troubleshooting
- **AGENTS.md**: Updated with Studio quick reference
- **screenshots/README.md**: Guidelines for capturing test screenshots

## Benefits

### For Development
- **Visual Debugging**: See agent reasoning and tool calls in real-time
- **Rapid Iteration**: Test changes without writing test code
- **Workflow Visualization**: Understand complex multi-step processes
- **Immediate Feedback**: See results instantly

### For Production
- **Monitoring**: Observe production agent behavior
- **Troubleshooting**: Debug issues with detailed traces
- **Performance**: Track token usage and response times
- **Evaluation**: Run scorers to measure quality

## Next Steps

1. **Test with Real Data**: Try the Studio with actual agent interactions
2. **Capture Screenshots**: Document the UI for future reference
3. **Performance Tuning**: Monitor resource usage with Studio
4. **Training**: Create guides for team members to use Studio

## Resources

- [Mastra Documentation](https://mastra.ai/docs)
- [Mastra Studio Guide](https://mastra.ai/docs/getting-started/studio)
- [Mastra CLI Reference](https://mastra.ai/reference/cli/mastra)
- [Project STUDIO.md](./STUDIO.md)
