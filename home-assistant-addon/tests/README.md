# Playwright E2E Tests for home-assistant-addon

This directory contains end-to-end tests for the home-assistant-addon Docker container using Playwright.

## Setup

The tests are integrated with the NX monorepo and use the root `package.json` dependencies.

## Test Files

- `e2e/docker-integration.spec.ts` - Full Docker lifecycle management tests with ingress simulation

## Running Tests

### Using NX (Recommended)

From the repository root:

```bash
# Run all E2E tests
npx nx test:e2e home-assistant-addon

# Run with Playwright UI
npx nx test:e2e:ui home-assistant-addon

# Run in debug mode
npx nx test:e2e:debug home-assistant-addon
```

### Manual Container Management

1. **Start the addon container:**
   ```bash
   cd home-assistant-addon/tests
   ./start-addon.sh
   ```

2. **Run the tests in a separate terminal:**
   ```bash
   cd home-assistant-addon
   npx playwright test
   ```

## What the Tests Check

1. **Nginx Ingress Simulation**: Tests Home Assistant's ingress proxy behavior
2. **Static Asset Loading**: Verifies all assets load correctly through the proxy
3. **Network Requests**: Monitors all network requests for failures (404s, 500s)
4. **Docker Container Lifecycle**: Manages container startup and cleanup

## Test Configuration

The tests are configured to:
- Use Chromium browser by default
- Wait for DOM content loaded (SSE connections stay open)
- Test against `localhost:5000` (nginx proxy port)
- Proxy `/api/hassio_ingress/redacted/` to the MCP server
- Allow 2 minutes timeout for Docker container startup

## Troubleshooting

### Container Not Ready
If tests fail with connection errors, ensure:
1. Docker container is running: `docker ps`
2. Port 5000 is accessible: `curl http://localhost:5000`
3. No port conflicts with other services

### Test Results
Test results and traces are saved to:
- `test-results/` - Test artifacts and screenshots
- `playwright-report/` - HTML test reports

View the HTML report:
```bash
npx playwright show-report
```

## Architecture

The test setup simulates Home Assistant's ingress behavior:

```
Browser → http://localhost:5000/api/hassio_ingress/redacted/
    ↓
  Nginx (port 5000)
    ↓
  MCP Server (port 5690)
    ↓
  Mastra Playground + J.A.R.V.I.S. MCP Server (port 4112)
```

This ensures that static assets load correctly when the addon is served under a subpath in production.
