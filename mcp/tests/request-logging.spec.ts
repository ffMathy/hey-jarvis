import { startMcpServerForTestingPurposes, stopMcpServer } from './utils/mcp-server-manager';

const MCP_SERVER_URL = 'http://localhost:4112';
const SERVER_STARTUP_TIMEOUT = 120000;

describe('MCP Server Request Logging', () => {
  beforeAll(async () => {
    // Verify required environment variables are set (loaded by run-with-env.sh)
    if (!process.env.HEY_JARVIS_MCP_JWT_SECRET) {
      throw new Error('HEY_JARVIS_MCP_JWT_SECRET not found - tests must be run via nx test which uses run-with-env.sh');
    }

    console.log('Starting MCP server programmatically...');
    await startMcpServerForTestingPurposes();

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('MCP server is ready!');
  }, SERVER_STARTUP_TIMEOUT);

  afterAll(async () => {
    console.log('Shutting down servers...');
    await stopMcpServer();
  });

  it('should log health check requests to stdout', async () => {
    // Capture console.log output
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    try {
      // Make a request to the health endpoint
      const response = await fetch(`${MCP_SERVER_URL}/health`);
      expect(response.status).toBe(200);

      // Wait a bit for the log to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that request was logged
      const requestLog = logs.find((log) => log.includes('GET /health'));
      expect(requestLog).toBeDefined();
      expect(requestLog).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] GET \/health/);

      // Verify that response was logged
      const responseLog = logs.find((log) => log.includes('200') && log.includes('ms'));
      expect(responseLog).toBeDefined();
      expect(responseLog).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] GET \/health - 200 \(\d+ms\)/);

      console.log('✓ Health check request logging verified');
    } finally {
      // Restore console.log
      console.log = originalLog;
    }
  });

  it('should log MCP endpoint requests to stdout', async () => {
    // Capture console.log output
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    try {
      // Make a request to the MCP endpoint (will fail auth, but should log)
      const response = await fetch(`${MCP_SERVER_URL}/api/mcp`);
      // Expect 401 because we didn't provide authentication
      expect(response.status).toBe(401);

      // Wait a bit for the log to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that request was logged
      const requestLog = logs.find((log) => log.includes('GET /api/mcp'));
      expect(requestLog).toBeDefined();
      expect(requestLog).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] GET \/api\/mcp/);

      // Verify that response was logged
      const responseLog = logs.find((log) => log.includes('401') && log.includes('ms'));
      expect(responseLog).toBeDefined();
      expect(responseLog).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] GET \/api\/mcp - 401 \(\d+ms\)/);

      console.log('✓ MCP endpoint request logging verified');
    } finally {
      // Restore console.log
      console.log = originalLog;
    }
  });
});
