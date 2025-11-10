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
    '^@mastra/evals/scorers/code$': '<rootDir>/../node_modules/@mastra/evals/dist/scorers/code/index.js',
    '^@mastra/evals/scorers/llm$': '<rootDir>/../node_modules/@mastra/evals/dist/scorers/llm/index.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'esbuild-jest',
      {
        sourcemap: true,
        format: 'esm',
      },
    ],
  },
  transformIgnorePatterns: [
    // Let Node handle ESM packages natively with --experimental-vm-modules
    'node_modules/',
  ],
};
