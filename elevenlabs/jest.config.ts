export default {
  displayName: 'elevenlabs',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testTimeout: 180000, // 3 minutes for server startup + tests
  maxWorkers: 1, // Run tests sequentially to avoid port conflicts
  forceExit: true, // Force Jest to exit after all tests complete
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          target: 'es2022',
          transform: {
            decoratorMetadata: true,
          },
        },
        module: {
          type: 'es6',
        },
      },
    ],
    '^.+\\.jsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'ecmascript',
          },
          target: 'es2022',
        },
        module: {
          type: 'es6',
        },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(exit-hook|@sindresorhus|escape-string-regexp|fkill|taskkill|execa|chalk|strip-ansi|ansi-regex|is-stream|human-signals|strip-final-newline|npm-run-path|path-key|mimic-fn|onetime|is-plain-obj|p-map)/)',
  ],
};
