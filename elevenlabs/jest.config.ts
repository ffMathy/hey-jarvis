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
    // Map @mastra/evals subpath exports to actual file locations
    '^@mastra/evals/scorers/llm$': '<rootDir>/../node_modules/@mastra/evals/dist/scorers/llm/index.js',
    '^@mastra/evals/scorers/code$': '<rootDir>/../node_modules/@mastra/evals/dist/scorers/code/index.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        // Skip type checking to avoid issues with package.json exports resolution
        diagnostics: {
          ignoreCodes: ['TS2307'],
        },
      },
    ],
  },
};
