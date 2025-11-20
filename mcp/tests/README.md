# MCP Tests

This directory contains tests for the Hey Jarvis MCP server.

## Test Files

### `mcp-client-connection.spec.ts`
Jest-based tests for the MCP server using the Mastra NPM package `@mastra/mcp` to create an MCP client and verify connectivity and functionality.

**Features tested:**
- Client connection to hosted MCP server
- Listing available tools
- Executing tools (e.g., weather tools)
- Listing toolsets (tools organized by server)
- Error handling for connection failures
- Server namespacing (all tools prefixed with server name)
- Accessing prompts and resources

## Running Tests

### Automatic Server Startup

The tests automatically start the MCP server in the background using Node.js `child_process.spawn()` before running tests. The server is shut down automatically after all tests complete.

### Prerequisites

**Ensure environment variables are configured** via 1Password:
- Sign in: `op signin`
- Verify: `op whoami`

### Run All Tests
```bash
nx test mcp
```

The MCP server will automatically start and stop with the test run.

### Run Tests with Jest CLI
```bash
cd mcp
bunx jest
```

### Run Tests in Watch Mode
```bash
cd mcp
bunx jest --watch
```

### Run Specific Test File
```bash
cd mcp
bunx jest mcp-client-connection.spec.ts
```

### Run Tests with Coverage
```bash
nx test mcp --coverage
```

## Test Behavior

- Tests use Jest with `beforeAll()` hook to start MCP server via `spawn()`
- Server starts on ports 4111 (Mastra UI) and 4112 (MCP server)
- Tests wait for port 4111 to be available before proceeding (max 120 seconds)
- All tests run sequentially (`maxWorkers: 1`) to avoid conflicts
- Server automatically shuts down in `afterAll()` hook
- Each test gets 3 minutes timeout to account for server startup
- Connection errors are tested separately and use invalid ports

## Environment

- **MCP Server URL**: `http://localhost:4112/api/mcp`
- **Mastra UI URL**: `http://localhost:4111`
- **Client Timeout**: 30 seconds
- **Server Startup Timeout**: 120 seconds
- **Server**: Exposes the following:
  - Weather agent
  - Shopping agent
  - Coding agent
  - Associated tools for each agent

## Troubleshooting

### "You are not currently signed in"
**Solution**: Sign into 1Password CLI with `op signin`

### Port already in use
**Solution**: Stop any running MCP server processes:
```bash
pkill -f "nx serve mcp"
```

### Tests timeout during server startup
**Solution**: 
- Check that 1Password is signed in: `op whoami`
- Verify required environment variables are in `mcp/op.env`
- Check server logs in test output for startup errors
- Ensure port 4111 is not blocked by firewall

### Server fails to start
**Solution**:
- Ensure all dependencies are installed: `bun install`
- Check that `nx serve mcp` works independently
- Verify environment variables are properly configured
- Look for errors in test output logs

### "Cannot find module" errors
**Solution**: The tests run directly on TypeScript files using `ts-jest`. Ensure all imports use proper extensions.

## Configuration

Test configuration is in `/workspaces/hey-jarvis/mcp/jest.config.ts`

Key settings:
- Test directory: `<rootDir>/tests/**/*.spec.ts`
- Test environment: Node.js
- Sequential execution (`maxWorkers: 1`)
- 180-second timeout per test (3 minutes)
- TypeScript support via `ts-jest`
- ESM module support enabled
