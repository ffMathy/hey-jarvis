export default {
  displayName: 'mcp',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testTimeout: 180000, // 3 minutes for server startup + tests
  maxWorkers: 1, // Run tests sequentially to avoid port conflicts
  forceExit: true, // Force Jest to exit after all tests complete
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
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
    '^.+\\.(js|mjs)$': [
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
  transformIgnorePatterns: [
    'node_modules/(?!(@mastra|exit-hook|fkill|execa|p-map|@sindresorhus|escape-string-regexp|strip-final-newline|npm-run-path|path-key|onetime|mimic-fn|human-signals|is-stream|merge-stream|get-stream|is-plain-obj|ps-list|taskkill|pidtree|arrify|aggregate-error|clean-stack|indent-string|figures|is-unicode-supported|unicorn-magic|yoctocolors)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
