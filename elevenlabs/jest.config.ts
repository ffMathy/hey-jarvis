export default {
  displayName: 'elevenlabs',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  coverageDirectory: '../coverage/elevenlabs',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  testTimeout: 60000,
  maxWorkers: 1, // Run tests serially to avoid MCP server port conflicts
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
};
