export default {
  displayName: 'elevenlabs',
  testEnvironment: 'node',
  coverageDirectory: './coverage/elevenlabs',
  testMatch: ['<rootDir>/dist/elevenlabs-test/**/*.spec.js', '<rootDir>/dist/elevenlabs-test/**/*.test.js'],
  testTimeout: 60000,
  maxWorkers: 1,
  moduleFileExtensions: ['js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Map cross-project imports to built dist folder
    '^mcp/mastra/mcp-server\\.js$': '<rootDir>/dist/mcp/mastra/mcp-server.js',
    '^mcp/tests/utils/mcp-server-manager$': '<rootDir>/dist/mcp/tests/utils/mcp-server-manager.js',
  },
  // No transform needed - running on compiled JavaScript
  transform: {},
  transformIgnorePatterns: [],
  rootDir: '..',
  coverageReporters: ['html'],
};
