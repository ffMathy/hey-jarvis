export default {
  displayName: 'elevenlabs',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../coverage/elevenlabs',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  testTimeout: 60000,
};
