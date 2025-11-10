export default {
  displayName: 'elevenlabs',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  coverageDirectory: '../coverage/elevenlabs',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  testTimeout: 60000,
  maxWorkers: 10,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Skip scorer imports during testing
    '^@mastra/evals/scorers/llm$': '<rootDir>/src/test-utils/__mocks__/empty-module.ts',
    '^@mastra/evals/scorers/code$': '<rootDir>/src/test-utils/__mocks__/empty-module.ts',
    // Mock the entire MCP server to avoid loading all dependencies
    '^mcp/mastra/mcp-server\\.js$': '<rootDir>/src/test-utils/__mocks__/mcp-server.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: 'esnext',
          moduleResolution: 'Bundler',
          target: 'esnext',
        },
        diagnostics: {
          ignoreCodes: ['TS2307'], // Ignore "Cannot find module" errors for @mastra/evals subpaths
        },
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@mastra|@sindresorhus|escape-string-regexp|exit-hook|onetime|mimic-function|execa|@elevenlabs|octokit|@octokit)/)',
  ],
};
